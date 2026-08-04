package com.helpdoit.api;

import com.helpdoit.knowledge.KnowledgeEntry;
import com.helpdoit.knowledge.KnowledgeEntryRepository;
import com.helpdoit.knowledge.KnowledgeService;
import com.helpdoit.tag.TagService;
import com.helpdoit.walkthrough.Walkthrough;
import com.helpdoit.walkthrough.WalkthroughRepository;
import com.helpdoit.walkthrough.WalkthroughService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.UUID;

/**
 * RSocket routes for EDITING an existing knowledge entry (the "retrain" flow). The
 * extension opens the entry's page with a {@code #helpdoit=k:<id>} deep-link, loads
 * the entry (answer + tags + recorded steps) into the review editor, and saves the
 * edits back to the SAME entry. Thin; delegates to the domain services.
 */
@Controller
class KnowledgeEditRsocketController {

    private final KnowledgeEntryRepository entries;
    private final TagService tagService;
    private final WalkthroughRepository walkthroughs;
    private final KnowledgeService knowledgeService;
    private final WalkthroughService walkthroughService;

    KnowledgeEditRsocketController(KnowledgeEntryRepository entries, TagService tagService,
                                   WalkthroughRepository walkthroughs, KnowledgeService knowledgeService,
                                   WalkthroughService walkthroughService) {
        this.entries = entries;
        this.tagService = tagService;
        this.walkthroughs = walkthroughs;
        this.knowledgeService = knowledgeService;
        this.walkthroughService = walkthroughService;
    }

    /** Load an entry for editing: title, answer, tags, and any recorded steps. */
    @MessageMapping("knowledge-edit")
    EditView edit(IdRequest request) {
        UUID id = UUID.fromString(request.knowledgeEntryId());
        KnowledgeEntry e = entries.findById(id).orElse(null);
        if (e == null) {
            return new EditView(request.knowledgeEntryId(), "", "", List.of(), false, "[]");
        }
        Walkthrough w = walkthroughs.findByKnowledgeEntryIdAndStatus(id, "ready").orElse(null);
        return new EditView(
            id.toString(), e.getTitle(), e.getContent(), tagService.tagsFor(id),
            w != null, w == null ? "[]" : w.getSteps());
    }

    /** Save edits back to the existing entry: title + answer + tags (replaced) + steps. */
    @MessageMapping("knowledge-update")
    UpdateResult update(UpdateRequest request) {
        UUID id = UUID.fromString(request.knowledgeEntryId());
        walkthroughService.updateSteps(id, request.steps());
        knowledgeService.update(id, request.question(), request.answer(),
            request.tags() == null ? List.of() : request.tags());
        return new UpdateResult(id.toString(), true);
    }

    record IdRequest(String knowledgeEntryId) {}

    /** steps is the raw step JSON array as a string (the widget JSON.parses it). */
    record EditView(String knowledgeEntryId, String question, String answer, List<String> tags,
                    boolean hasWalkthrough, String steps) {}

    record UpdateRequest(String knowledgeEntryId, String question, String answer, List<String> tags, String steps) {}
    record UpdateResult(String knowledgeEntryId, boolean saved) {}
}
