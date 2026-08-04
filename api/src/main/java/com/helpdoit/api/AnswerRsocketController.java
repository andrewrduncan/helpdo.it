package com.helpdoit.api;

import com.helpdoit.knowledge.KnowledgeEntry;
import com.helpdoit.knowledge.KnowledgeEntryRepository;
import com.helpdoit.walkthrough.Walkthrough;
import com.helpdoit.walkthrough.WalkthroughRepository;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.util.UUID;

/**
 * RSocket "answer" route — fetch a knowledge entry's full answer by id. The widget
 * calls this when a user clicks one of the suggested options (bubbles) returned by
 * an ask. Also reports whether a recorded walkthrough backs the entry, so the widget
 * can offer guided playback. Thin.
 */
@Controller
class AnswerRsocketController {

    private final KnowledgeEntryRepository entries;
    private final WalkthroughRepository walkthroughs;

    AnswerRsocketController(KnowledgeEntryRepository entries, WalkthroughRepository walkthroughs) {
        this.entries = entries;
        this.walkthroughs = walkthroughs;
    }

    @MessageMapping("answer")
    AnswerView answer(AnswerRequest request) {
        UUID id = UUID.fromString(request.knowledgeEntryId());
        KnowledgeEntry entry = entries.findById(id).orElse(null);
        if (entry == null) {
            return new AnswerView(request.knowledgeEntryId(), "", "", false, null);
        }
        Walkthrough w = walkthroughs.findByKnowledgeEntryIdAndStatus(id, "ready").orElse(null);
        return new AnswerView(
            id.toString(),
            entry.getTitle(),
            entry.getContent(),
            w != null,
            w == null ? null : w.getId().toString());
    }

    /**
     * Fetch the recorded steps for an entry's walkthrough — the widget plays these
     * back (animated cursor + clicks). Steps carry their resolution-independent
     * locator (selector/hierarchy/text + offset) and AI caption. Screenshots are
     * NOT included (kept small for the channel; playback re-resolves live elements).
     */
    @MessageMapping("walkthrough-steps")
    StepsView steps(AnswerRequest request) {
        UUID id = UUID.fromString(request.knowledgeEntryId());
        Walkthrough w = walkthroughs.findByKnowledgeEntryIdAndStatus(id, "ready").orElse(null);
        // Return the raw JSON string (the client parses it). Returning a Jackson tree
        // here would be mis-serialized by Boot 4's Jackson 3 — surfacing its getters.
        return w == null ? new StepsView(null, "[]") : new StepsView(w.getId().toString(), w.getSteps());
    }

    record AnswerRequest(String knowledgeEntryId) {}

    /** steps is the raw typed-step JSON array as a string (the widget JSON.parses it). */
    record StepsView(String walkthroughId, String steps) {}

    /** walkthroughId is non-null when hasWalkthrough — the widget uses it to start playback. */
    record AnswerView(String knowledgeEntryId, String title, String answer, boolean hasWalkthrough,
                      String walkthroughId) {}
}
