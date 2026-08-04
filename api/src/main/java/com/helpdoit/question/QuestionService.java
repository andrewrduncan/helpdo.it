package com.helpdoit.question;

import com.helpdoit.ai.RetrievedChunk;
import com.helpdoit.ai.VectorStorePort;
import com.helpdoit.attachment.Attachment;
import com.helpdoit.attachment.AttachmentConverter;
import com.helpdoit.attachment.ConvertedAttachment;
import com.helpdoit.domain.DomainService;
import com.helpdoit.knowledge.KnowledgeEntry;
import com.helpdoit.knowledge.KnowledgeEntryRepository;
import com.helpdoit.walkthrough.WalkthroughRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The retrieve → answer-or-escalate flow. Embeds the question + searches the
 * knowledge corpus (via the vector store); a hit above the similarity threshold
 * answers it, otherwise the question is queued for an admin. Every ask is
 * recorded (the demand signal).
 *
 * <p>Knowledge entries carry their relational id in the vector document's
 * metadata under {@link #KNOWLEDGE_ENTRY_ID} so a hit maps back to the entry.
 */
@Service
public class QuestionService {

    /** Metadata key on indexed knowledge documents → the knowledge_entry id. */
    public static final String KNOWLEDGE_ENTRY_ID = "knowledgeEntryId";

    private static final Logger log = LoggerFactory.getLogger(QuestionService.class);

    private final VectorStorePort vectorStore;
    private final QuestionRepository questions;
    private final QuestionAttachmentRepository attachments;
    private final KnowledgeEntryRepository knowledgeEntries;
    private final AttachmentConverter converter;
    private final RetrievalGrader grader;
    private final QueryReformulator reformulator;
    private final WalkthroughRepository walkthroughs;
    private final DomainService domainService;
    private final double recallFloor;
    private final double highConfidence;
    private final int topK;
    private final int maxOptions;
    private final int reformulations;

    public QuestionService(
            VectorStorePort vectorStore,
            QuestionRepository questions,
            QuestionAttachmentRepository attachments,
            KnowledgeEntryRepository knowledgeEntries,
            AttachmentConverter converter,
            RetrievalGrader grader,
            QueryReformulator reformulator,
            WalkthroughRepository walkthroughs,
            DomainService domainService,
            // Wide net for recall: keep any candidate above this; the AI grader decides relevance.
            @Value("${helpdoit.rag.recall-floor:0.2}") double recallFloor,
            // Above this similarity we trust the top hit and skip the LLM grading call.
            @Value("${helpdoit.rag.high-confidence:0.85}") double highConfidence,
            @Value("${helpdoit.rag.top-k:6}") int topK,
            // Most options to offer as bubbles when several entries are relevant.
            @Value("${helpdoit.rag.max-options:4}") int maxOptions,
            // How many query rewrites to try when the first search finds nothing relevant.
            @Value("${helpdoit.rag.reformulations:3}") int reformulations) {
        this.vectorStore = vectorStore;
        this.questions = questions;
        this.attachments = attachments;
        this.knowledgeEntries = knowledgeEntries;
        this.converter = converter;
        this.grader = grader;
        this.reformulator = reformulator;
        this.walkthroughs = walkthroughs;
        this.domainService = domainService;
        this.recallFloor = recallFloor;
        this.highConfidence = highConfidence;
        this.topK = topK;
        this.maxOptions = maxOptions;
        this.reformulations = reformulations;
    }

    /** Ask with no attachments (the RSocket path). */
    @Transactional
    public AskResult ask(String text, String pageContext, String pageUrl, String askedBy) {
        return ask(text, pageContext, pageUrl, askedBy, List.of());
    }

    /**
     * Ask, optionally with attached files. Documents are extracted to text and folded
     * into the retrieval query (better matching); all attachments are stored on the
     * question so a trainer sees them in the queue. Images aren't interpreted at ask
     * time — they're context for the human answering it.
     */
    @Transactional
    public AskResult ask(String text, String pageContext, String pageUrl, String askedBy,
                         List<Attachment> files) {
        List<ConvertedAttachment> converted = (files == null ? List.<Attachment>of() : files).stream()
            .map(converter::convert)
            .toList();

        // Extracted document text augments only the retrieval query, not the stored
        // question text (the trainer should read the user's actual words).
        StringBuilder query = new StringBuilder(text == null ? "" : text);
        for (ConvertedAttachment c : converted) {
            if (c.kind() == ConvertedAttachment.Kind.TEXT && c.text() != null) {
                query.append("\n\n").append(c.text());
            }
        }

        // Scope retrieval to the page's domain (its hostname) so one site's answers
        // never leak into another's. Null host (unknown page) → unscoped search.
        String host = DomainService.hostOf(pageUrl);

        // Wide net for recall (drop only near-noise); the AI grader does precision.
        List<RetrievedChunk> candidates = vectorStore.search(query.toString(), topK, host).stream()
            .filter(chunk -> chunk.score() >= recallFloor)
            .toList();
        List<RetrievedChunk> relevant = pickRelevant(text, candidates, host);

        Question question = new Question();
        question.setText(text);
        question.setPageContext(pageContext);
        question.setPageUrl(pageUrl);
        question.setAskedBy(askedBy);
        domainService.resolveByHost(host).ifPresent(d -> question.setDomainId(d.getId()));

        List<AnswerOption> options = toOptions(relevant);
        if (options.isEmpty()) {
            question.setStatus("queued");
            questions.save(question);
            storeAttachments(question.getId(), converted);
            log.debug("Question queued (no relevant entry after grading + escalation): {}", text);
            return new AskResult(question.getId(), false, null, null, List.of());
        }

        // A single relevant entry is answered inline; several become choosable bubbles.
        if (options.size() == 1) {
            AnswerOption only = options.get(0);
            UUID entryId = UUID.fromString(only.knowledgeEntryId());
            String answer = knowledgeEntries.findById(entryId).map(KnowledgeEntry::getContent).orElse("");
            question.setStatus("answered");
            question.setAnsweredByEntry(entryId);
            questions.save(question);
            storeAttachments(question.getId(), converted);
            log.debug("Question answered with one entry {}: {}", entryId, text);
            return new AskResult(question.getId(), true, answer, entryId, options);
        }

        question.setStatus("answered"); // help was surfaced; the user picks which
        questions.save(question);
        storeAttachments(question.getId(), converted);
        log.debug("Question surfaced {} options: {}", options.size(), text);
        return new AskResult(question.getId(), true, null, null, options);
    }

    /**
     * The relevant candidates for a question, ranked best-first (empty if none). When
     * there's a SINGLE high-confidence candidate we trust it directly (no LLM); but
     * with several candidates we always let the AI grader decide which are relevant —
     * so genuine alternatives are offered as options rather than suppressed by a strong
     * top hit. If the grader finds nothing, we escalate (reformulate, re-search, re-grade)
     * before giving up. Tolerant of typos/paraphrasing, strict about intent.
     */
    private List<RetrievedChunk> pickRelevant(String question, List<RetrievedChunk> candidates, String host) {
        if (candidates.isEmpty()) {
            return escalate(question, candidates, host);
        }
        // Only short-circuit when there's nothing to choose between — one obvious hit.
        if (candidates.size() == 1 && candidates.get(0).score() >= highConfidence) {
            return candidates;
        }
        List<RetrievedChunk> graded = byIndices(candidates, grader.selectRelevant(question, candidates));
        if (!graded.isEmpty()) {
            return graded;
        }
        return escalate(question, candidates, host);
    }

    /** On miss: rewrite the query, re-search (same domain scope), and grade the merged pool. */
    private List<RetrievedChunk> escalate(String question, List<RetrievedChunk> seed, String host) {
        List<String> queries = reformulator.reformulate(question, reformulations);
        if (queries.isEmpty()) {
            return List.of();
        }
        Map<String, RetrievedChunk> pool = new LinkedHashMap<>(); // de-dupe by entry, keep order
        for (RetrievedChunk c : seed) {
            pool.putIfAbsent(c.id(), c);
        }
        for (String q : queries) {
            vectorStore.search(q, topK, host).stream()
                .filter(c -> c.score() >= recallFloor)
                .forEach(c -> pool.putIfAbsent(c.id(), c));
        }
        List<RetrievedChunk> pooled = new ArrayList<>(pool.values());
        return byIndices(pooled, grader.selectRelevant(question, pooled));
    }

    private static List<RetrievedChunk> byIndices(List<RetrievedChunk> from, List<Integer> indices) {
        List<RetrievedChunk> out = new ArrayList<>();
        for (int i : indices) {
            out.add(from.get(i));
        }
        return out;
    }

    /**
     * Resolve ranked candidates to choosable options (loads title + walkthrough flag),
     * capped. De-duplicates by normalized title so near-identical entries never appear
     * as repeated bubbles, preferring the variant that has a playable walkthrough.
     */
    private List<AnswerOption> toOptions(List<RetrievedChunk> relevant) {
        Map<String, AnswerOption> byTitle = new LinkedHashMap<>(); // preserve rank order
        for (RetrievedChunk c : relevant) {
            UUID entryId = knowledgeEntryId(c);
            if (entryId == null) {
                continue;
            }
            KnowledgeEntry entry = knowledgeEntries.findById(entryId).orElse(null);
            if (entry == null) {
                continue; // de-indexed / orphaned vector row
            }
            boolean hasWalkthrough = walkthroughs.findByKnowledgeEntryIdAndStatus(entryId, "ready").isPresent();
            AnswerOption option =
                new AnswerOption(entryId.toString(), entry.getTitle(), snippet(entry.getContent()), hasWalkthrough);
            String key = entry.getTitle() == null ? entryId.toString() : entry.getTitle().trim().toLowerCase();
            AnswerOption existing = byTitle.get(key);
            // Keep the first (best-ranked), but upgrade to a walkthrough-backed duplicate.
            if (existing == null || (!existing.hasWalkthrough() && hasWalkthrough)) {
                byTitle.put(key, option);
            }
            if (byTitle.size() >= maxOptions) {
                break;
            }
        }
        return new ArrayList<>(byTitle.values());
    }

    private static String snippet(String content) {
        if (content == null) {
            return "";
        }
        String s = content.strip();
        return s.length() > 140 ? s.substring(0, 140) + "…" : s;
    }

    /** Persist converted attachments against a question: image bytes for viewing, text for docs. */
    private void storeAttachments(UUID questionId, List<ConvertedAttachment> converted) {
        for (ConvertedAttachment c : converted) {
            QuestionAttachment row = new QuestionAttachment();
            row.setQuestionId(questionId);
            row.setFilename(c.filename());
            row.setKind(c.kind().name().toLowerCase());
            switch (c.kind()) {
                case IMAGE -> {
                    row.setContentType(c.media().mimeType());
                    row.setImage(Base64.getEncoder().encodeToString(c.media().data()));
                }
                case TEXT -> {
                    row.setContentType("text/plain");
                    row.setExtractedText(c.text());
                }
                case UNSUPPORTED -> {
                    row.setContentType("application/octet-stream");
                    row.setExtractedText(c.text()); // the placeholder note
                }
            }
            attachments.save(row);
        }
    }

    private static UUID knowledgeEntryId(RetrievedChunk chunk) {
        Object id = chunk.metadata() == null ? null : chunk.metadata().get(KNOWLEDGE_ENTRY_ID);
        if (id == null) {
            return null;
        }
        try {
            return UUID.fromString(id.toString());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
