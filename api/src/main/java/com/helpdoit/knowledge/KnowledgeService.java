package com.helpdoit.knowledge;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.helpdoit.ai.AiModels;
import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.ChatPrompt;
import com.helpdoit.ai.KnowledgeChunk;
import com.helpdoit.ai.VectorStorePort;
import com.helpdoit.domain.Domain;
import com.helpdoit.domain.DomainService;
import com.helpdoit.question.QuestionService;
import com.helpdoit.tag.TagService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Authoring side of the corpus: persist a knowledge entry AND index it into the
 * vector store so it can immediately answer questions. This is what Train mode
 * (and, later, the admin resolve flow) calls.
 *
 * <p>The indexed document's text is {@code title + content} (so a user's question
 * matches either the topic or the answer wording); its metadata carries the
 * {@code knowledgeEntryId} so a retrieval hit maps back to this row, and the
 * page URL for optional scoping. On a hit, {@link QuestionService} loads the
 * entry and returns its {@code content} as the answer.
 */
@Service
public class KnowledgeService {

    /** Metadata key for the originating page on an indexed document. */
    public static final String PAGE_URL = "pageUrl";

    /** Metadata key for the domain (page hostname) on an indexed document — the search filter. */
    public static final String DOMAIN = "domain";

    private static final Logger log = LoggerFactory.getLogger(KnowledgeService.class);

    /** Local mapper for the small metadata blob — not the (Jackson 3) Boot bean. */
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final KnowledgeEntryRepository entries;
    private final VectorStorePort vectorStore;
    private final ChatModelPort chat;
    private final TagService tagService;
    private final DomainService domainService;
    private final AiModels models;
    private final boolean indexExpansion;

    public KnowledgeService(KnowledgeEntryRepository entries, VectorStorePort vectorStore, ChatModelPort chat,
                            TagService tagService, DomainService domainService, AiModels models,
                            @Value("${helpdoit.rag.index-expansion:true}") boolean indexExpansion) {
        this.entries = entries;
        this.vectorStore = vectorStore;
        this.chat = chat;
        this.tagService = tagService;
        this.domainService = domainService;
        this.models = models;
        this.indexExpansion = indexExpansion;
    }

    /** Train with no tags. */
    public KnowledgeEntry train(String question, String answer, String pageUrl, String authoredBy) {
        return train(question, answer, pageUrl, authoredBy, List.of());
    }

    /**
     * Record a trained answer: a representative question and its answer, scoped to
     * the page it was authored on and attributed to the trainer. Attaches the tags,
     * then indexes (title + content + AI variants + the tags as keywords) so a user
     * searching those keywords matches. Tags are attached BEFORE indexing on purpose.
     */
    @Transactional
    public KnowledgeEntry train(String question, String answer, String pageUrl, String authoredBy, List<String> tags) {
        // The page's host IS the domain. Registering it is implicit: the first entry
        // trained on a host creates its domain so users can then enable it.
        String host = DomainService.hostOf(pageUrl);
        Domain domain = domainService.register(host, authoredBy);

        KnowledgeEntry entry = new KnowledgeEntry();
        entry.setTitle(question);
        entry.setContent(answer);
        entry.setSource("training");
        entry.setDomainId(domain == null ? null : domain.getId());
        entry.setMetadata(metadataJson(pageUrl, authoredBy));
        entries.save(entry);

        tagService.attach(entry.getId(), tags);
        index(entry, pageUrl, host, tags);
        log.debug("Trained knowledge {} (domain {}, {} tags): {}", entry.getId(), host,
            tags == null ? 0 : tags.size(), question);
        return entry;
    }

    /**
     * Edit an existing entry (the "retrain"/edit flow): update title + answer, replace
     * the tag set, and re-index (re-embed title + content + variants + tags, upserting
     * the same vector id). Walkthrough steps are updated separately by the caller.
     */
    @Transactional
    public void update(java.util.UUID id, String title, String answer, List<String> tags) {
        KnowledgeEntry entry = entries.findById(id).orElseThrow();
        if (title != null && !title.isBlank()) {
            entry.setTitle(title.trim());
        }
        if (answer != null && !answer.isBlank()) {
            entry.setContent(answer);
        }
        entries.save(entry);
        tagService.setTags(id, tags);
        String pageUrl = pageUrlOf(entry);
        index(entry, pageUrl, DomainService.hostOf(pageUrl), tags == null ? List.of() : tags);
        log.debug("Updated knowledge {} ({} tags)", id, tags == null ? 0 : tags.size());
    }

    /** The originating page recorded in the entry's metadata blob (for re-index scoping). */
    private String pageUrlOf(KnowledgeEntry entry) {
        try {
            JsonNode m = MAPPER.readTree(entry.getMetadata() == null ? "{}" : entry.getMetadata());
            String url = m.path(PAGE_URL).asText("");
            return url.isBlank() ? null : url;
        } catch (Exception e) {
            return null;
        }
    }

    /** Delete a knowledge entry: de-index it (stops answering) and remove the row.
     *  Cascades drop its tag links and any authoring walkthrough (FKs). */
    @Transactional
    public void delete(java.util.UUID id) {
        vectorStore.delete(List.of(id.toString()));
        entries.deleteById(id);
        log.debug("Deleted knowledge {} (de-indexed + removed)", id);
    }

    /** Embed and upsert the entry into the vector store, tagged for retrieval lookup. */
    private void index(KnowledgeEntry entry, String pageUrl, String host, List<String> tags) {
        Map<String, Object> metadata = new HashMap<>();
        metadata.put(QuestionService.KNOWLEDGE_ENTRY_ID, entry.getId().toString());
        if (pageUrl != null && !pageUrl.isBlank()) {
            metadata.put(PAGE_URL, pageUrl);
        }
        if (host != null && !host.isBlank()) {
            metadata.put(DOMAIN, host); // the search filter — scopes retrieval to this domain
        }
        // Indexed text = title + content + AI-generated question variants + the tags
        // (keywords a user might search for). The variants + tags widen recall; the
        // authoritative answer returned to the user is always the entry's content.
        StringBuilder text = new StringBuilder(entry.getTitle()).append("\n\n").append(entry.getContent());
        String variants = variantsFor(entry.getTitle());
        if (!variants.isBlank()) {
            text.append("\n\n").append(variants);
        }
        if (tags != null && !tags.isEmpty()) {
            String keywords = tags.stream().filter(t -> t != null && !t.isBlank()).map(String::trim)
                .reduce((a, b) -> a + ", " + b).orElse("");
            if (!keywords.isBlank()) {
                text.append("\n\nKeywords: ").append(keywords);
            }
        }
        vectorStore.upsert(List.of(new KnowledgeChunk(entry.getId().toString(), text.toString(), metadata)));
    }

    /** Ask the model for alternative phrasings of the question, to broaden retrieval. Best-effort. */
    private String variantsFor(String question) {
        if (!indexExpansion || question == null || question.isBlank()) {
            return "";
        }
        try {
            String raw = chat.complete(new ChatPrompt(
                "Return ONLY a JSON array of strings, no markdown fences.",
                "A user asked: \"" + question.trim() + "\". List up to 6 alternative phrasings or "
                    + "closely related questions a different user might type to mean the same thing. "
                    + "Vary wording and synonyms; keep each short."), models.fast());
            JsonNode arr = MAPPER.readTree(stripFences(raw));
            if (!arr.isArray()) {
                return "";
            }
            StringBuilder sb = new StringBuilder();
            arr.forEach(n -> {
                String v = n.asText("").trim();
                if (!v.isBlank()) {
                    sb.append(v).append('\n');
                }
            });
            return sb.toString().trim();
        } catch (Exception e) {
            log.debug("Index expansion failed for '{}'; indexing without variants", question, e);
            return "";
        }
    }

    private static String stripFences(String s) {
        if (s == null) {
            return "[]";
        }
        String t = s.trim();
        int open = t.indexOf('[');
        int close = t.lastIndexOf(']');
        return (open >= 0 && close > open) ? t.substring(open, close + 1) : t;
    }

    /** Small JSON blob persisted on the entry row (tags/provenance). */
    private String metadataJson(String pageUrl, String authoredBy) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (pageUrl != null && !pageUrl.isBlank()) {
            m.put(PAGE_URL, pageUrl);
        }
        if (authoredBy != null && !authoredBy.isBlank()) {
            m.put("authoredBy", authoredBy);
        }
        try {
            return MAPPER.writeValueAsString(m);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }
}
