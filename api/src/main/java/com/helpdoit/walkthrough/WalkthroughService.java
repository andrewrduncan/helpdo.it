package com.helpdoit.walkthrough;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.helpdoit.ai.MediaPart;
import com.helpdoit.knowledge.KnowledgeEntry;
import com.helpdoit.knowledge.KnowledgeService;
import com.helpdoit.question.Question;
import com.helpdoit.question.QuestionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Records a walkthrough as it streams in from Train mode: create on start, append
 * each typed step (and its optional screenshot) as it arrives, finalize on stop.
 * Steps are kept as a JSON array on the {@link Walkthrough}; screenshots (one per
 * step, only when capture is on) go to {@code walkthrough_screenshot}.
 *
 * <p>On Stop ({@link #finish}) it runs the AI summarize pass (answer + per-step
 * captions), authors the {@code knowledge_entry} (tags attached, walkthrough
 * linked, indexed for retrieval), and resolves the originating queued question.
 */
@Service
public class WalkthroughService {

    private static final Logger log = LoggerFactory.getLogger(WalkthroughService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final WalkthroughRepository walkthroughs;
    private final WalkthroughScreenshotRepository screenshots;
    private final WalkthroughSummarizer summarizer;
    private final KnowledgeService knowledgeService;
    private final QuestionRepository questions;

    public WalkthroughService(WalkthroughRepository walkthroughs, WalkthroughScreenshotRepository screenshots,
                              WalkthroughSummarizer summarizer, KnowledgeService knowledgeService,
                              QuestionRepository questions) {
        this.walkthroughs = walkthroughs;
        this.screenshots = screenshots;
        this.summarizer = summarizer;
        this.knowledgeService = knowledgeService;
        this.questions = questions;
    }

    /** A review draft from Stop: generated answer + captioned steps, NOT yet authored. */
    public record DraftResult(UUID walkthroughId, String status, String answer, String stepsJson, int stepCount) {}

    /** Outcome of saving a reviewed walkthrough — the authored knowledge entry. */
    public record SaveResult(UUID walkthroughId, String status, UUID knowledgeEntryId, int stepCount) {}

    @Transactional
    public Walkthrough start(UUID questionId, boolean captureScreens, String createdBy) {
        Walkthrough w = new Walkthrough();
        w.setQuestionId(questionId);
        w.setCaptureScreens(captureScreens);
        w.setCreatedBy(createdBy);
        w.setStatus("recording");
        w.setSteps("[]");
        Walkthrough saved = walkthroughs.save(w);
        log.debug("Recording started: walkthrough {} (question {})", saved.getId(), questionId);
        return saved;
    }

    /** Append a typed step; returns the running step count. (Screenshots arrive
     *  separately over HTTP — too large for an RSocket-over-WS frame.) */
    @Transactional
    public int appendStep(UUID walkthroughId, Map<String, Object> step) {
        Walkthrough w = walkthroughs.findById(walkthroughId).orElseThrow();

        ArrayNode steps;
        try {
            steps = (ArrayNode) MAPPER.readTree(w.getSteps());
        } catch (Exception e) {
            steps = MAPPER.createArrayNode();
        }
        int index = steps.size();
        steps.add(MAPPER.valueToTree(step));
        try {
            w.setSteps(MAPPER.writeValueAsString(steps));
        } catch (Exception e) {
            log.warn("Could not serialize steps for walkthrough {}", walkthroughId, e);
        }
        walkthroughs.save(w);
        return index + 1;
    }

    /** Store a step's screenshot (uploaded over HTTP). Idempotent per (walkthrough, step). */
    @Transactional
    public void saveScreenshot(UUID walkthroughId, int stepIndex, String image, String contentType) {
        if (image == null || image.isBlank()) {
            return;
        }
        if (screenshots.existsByWalkthroughIdAndStepIndex(walkthroughId, stepIndex)) {
            return;
        }
        WalkthroughScreenshot shot = new WalkthroughScreenshot();
        shot.setWalkthroughId(walkthroughId);
        shot.setStepIndex(stepIndex);
        shot.setImage(image);
        if (contentType != null && !contentType.isBlank()) {
            shot.setContentType(contentType);
        }
        screenshots.save(shot);
    }

    /**
     * Finalize a recording: summarize the steps into an answer + per-step captions,
     * author a knowledge entry (tags attached, walkthrough linked, indexed), resolve
     * the originating question, and mark the walkthrough ready.
     *
     * <p>Not {@code @Transactional}: the AI call can take seconds — we don't want to
     * hold a DB transaction open across it. The individual repository/service writes
     * below are each transactional on their own.
     *
     * @param question the authoritative question text (trainer may have edited it)
     * @param tags     tag names to attach to the authored entry
     */
    public DraftResult summarize(UUID walkthroughId, String question) {
        // Idempotent: Stop can take many seconds to summarize and may be clicked again.
        // Atomically claim (recording → summarizing); a second call just returns current.
        if (!claim(walkthroughId, "recording", "summarizing")) {
            Walkthrough cur = walkthroughs.findById(walkthroughId).orElseThrow();
            ArrayNode steps = parseSteps(cur.getSteps());
            log.debug("summarize() ignored — walkthrough {} already {}", walkthroughId, cur.getStatus());
            return new DraftResult(walkthroughId, cur.getStatus(), null, cur.getSteps(), steps.size());
        }

        Walkthrough w = walkthroughs.findById(walkthroughId).orElseThrow();
        ArrayNode steps = parseSteps(w.getSteps());

        if (steps.isEmpty()) {
            w.setStatus("review");
            walkthroughs.save(w);
            return new DraftResult(walkthroughId, "review", "", "[]", 0);
        }

        WalkthroughSummarizer.Summary summary = summarizer.summarize(question, steps, loadScreenshots(walkthroughId));
        applyHints(steps, summary);
        String stepsJson;
        try {
            stepsJson = MAPPER.writeValueAsString(steps);
        } catch (Exception e) {
            stepsJson = w.getSteps();
        }
        w.setSteps(stepsJson);
        w.setStatus("review"); // parked for the trainer to review/edit before Save
        walkthroughs.save(w);
        log.debug("Recording summarized into a draft: walkthrough {} ({} steps)", walkthroughId, steps.size());
        return new DraftResult(walkthroughId, "review", summary.answer(), stepsJson, steps.size());
    }

    /** Rewrite the draft answer from the trainer's edited step captions (review editor). */
    public String resummarize(String question, String stepsJson) {
        return summarizer.answerFromSteps(question, parseSteps(stepsJson));
    }

    /** Edit flow: replace a ready walkthrough's steps (from the editor). No-op if none. */
    @Transactional
    public void updateSteps(UUID knowledgeEntryId, String stepsJson) {
        if (stepsJson == null || stepsJson.isBlank()) {
            return;
        }
        walkthroughs.findByKnowledgeEntryIdAndStatus(knowledgeEntryId, "ready").ifPresent(w -> {
            try {
                w.setSteps(MAPPER.writeValueAsString(parseSteps(stepsJson)));
                walkthroughs.save(w);
            } catch (Exception e) {
                log.warn("Could not update steps for walkthrough {}", w.getId(), e);
            }
        });
    }

    /**
     * Save a reviewed walkthrough as knowledge: persist the (possibly edited) steps,
     * author the entry from the final answer, attach tags, link + index, resolve the
     * originating question, mark ready. Idempotent.
     */
    public SaveResult save(UUID walkthroughId, String question, List<String> tags, String answer, String editedStepsJson) {
        if (!claim(walkthroughId, "review", "saving")) {
            Walkthrough done = walkthroughs.findById(walkthroughId).orElseThrow();
            log.debug("save() ignored — walkthrough {} already {}", walkthroughId, done.getStatus());
            return new SaveResult(walkthroughId, done.getStatus(), done.getKnowledgeEntryId(), parseSteps(done.getSteps()).size());
        }

        Walkthrough w = walkthroughs.findById(walkthroughId).orElseThrow();
        ArrayNode steps = (editedStepsJson != null && !editedStepsJson.isBlank())
            ? parseSteps(editedStepsJson) : parseSteps(w.getSteps());
        try {
            w.setSteps(MAPPER.writeValueAsString(steps));
        } catch (Exception e) {
            log.warn("Could not persist edited steps for walkthrough {}", walkthroughId, e);
        }

        String title = (question == null || question.isBlank()) ? "Walkthrough" : question.trim();
        String finalAnswer = (answer == null || answer.isBlank()) ? title : answer;
        String pageUrl = firstUrl(steps);
        // train() attaches the tags AND folds them into the index (keywords).
        KnowledgeEntry entry = knowledgeService.train(title, finalAnswer, pageUrl, w.getCreatedBy(), tags);

        w.setKnowledgeEntryId(entry.getId());
        w.setStatus("ready");
        walkthroughs.save(w);

        if (w.getQuestionId() != null) {
            questions.findById(w.getQuestionId()).ifPresent(q -> {
                q.setStatus("answered");
                q.setAnsweredByEntry(entry.getId());
                questions.save(q);
            });
        }
        log.debug("Walkthrough saved: {} → knowledge {} ({} steps)", walkthroughId, entry.getId(), steps.size());
        return new SaveResult(walkthroughId, "ready", entry.getId(), steps.size());
    }

    /**
     * Atomic status transition ({@code from} → {@code to}); returns true if this call
     * made the change. Guards the slow draft/save steps against double-clicks. Own
     * transaction so the new status is committed before any long work runs.
     */
    @Transactional
    protected boolean claim(UUID walkthroughId, String from, String to) {
        Walkthrough w = walkthroughs.findById(walkthroughId).orElseThrow();
        if (!from.equals(w.getStatus())) {
            return false;
        }
        w.setStatus(to);
        walkthroughs.save(w);
        return true;
    }

    /** Cap how many step screenshots we send to the vision model (latency/cost). */
    private static final int MAX_VISION_SHOTS = 12;

    /** Load this walkthrough's screenshots (in step order) as decoded media for vision. */
    private List<MediaPart> loadScreenshots(UUID walkthroughId) {
        List<MediaPart> media = new ArrayList<>();
        for (WalkthroughScreenshot shot : screenshots.findByWalkthroughIdOrderByStepIndexAsc(walkthroughId)) {
            if (media.size() >= MAX_VISION_SHOTS) {
                break;
            }
            try {
                media.add(new MediaPart(shot.getContentType(), Base64.getDecoder().decode(shot.getImage())));
            } catch (IllegalArgumentException e) {
                log.debug("Skipping un-decodable screenshot {} of walkthrough {}", shot.getStepIndex(), walkthroughId);
            }
        }
        return media;
    }

    private ArrayNode parseSteps(String json) {
        try {
            JsonNode node = MAPPER.readTree(json);
            return node instanceof ArrayNode arr ? arr : MAPPER.createArrayNode();
        } catch (Exception e) {
            return MAPPER.createArrayNode();
        }
    }

    /** Write the AI's caption + playback mode/prompt onto each step by index. */
    private void applyHints(ArrayNode steps, WalkthroughSummarizer.Summary summary) {
        List<String> captions = summary.captions();
        List<String> modes = summary.modes();
        List<String> prompts = summary.prompts();
        for (int i = 0; i < steps.size(); i++) {
            if (!(steps.get(i) instanceof ObjectNode step)) {
                continue;
            }
            if (i < captions.size()) {
                step.put("caption", captions.get(i));
            }
            // mode/prompt drive interactive playback (auto vs ask-to-type vs let-user-pick).
            String suggested = i < modes.size() ? modes.get(i) : "auto";
            String type = step.path("type").asText("click");
            step.put("mode", reconcileMode(type, suggested));
            step.put("prompt", i < prompts.size() && prompts.get(i) != null ? prompts.get(i) : "");
        }
    }

    /**
     * Force the playback mode to be sensible for the step's action type — the model
     * occasionally mislabels (e.g. tagging a typing step "pick", which makes playback
     * treat clicking into the field as "choosing a result" and skip the typing pause).
     *
     * <ul>
     *   <li>navigate — always "auto" (skipped during playback).
     *   <li>input (typing) — only "auto" or "input"; "pick" makes no sense → "input".
     *   <li>click/select/toggle/rightClick — only "auto" or "pick"; "input" needs a
     *       text field → "auto".
     * </ul>
     */
    private static String reconcileMode(String type, String suggested) {
        String m = suggested == null || suggested.isBlank() ? "auto" : suggested.trim().toLowerCase();
        return switch (type) {
            case "navigate" -> "auto";
            case "input" -> m.equals("input") || m.equals("auto") ? m : "input";
            default -> m.equals("pick") || m.equals("auto") ? m : "auto";
        };
    }

    /** The page the recording started on — where guided playback should begin. */
    private String firstUrl(ArrayNode steps) {
        for (JsonNode s : steps) {
            String url = s.path("url").asText("");
            if (!url.isBlank()) {
                return url;
            }
        }
        return null;
    }
}
