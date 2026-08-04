package com.helpdoit.api;

import com.helpdoit.knowledge.KnowledgeEntry;
import com.helpdoit.knowledge.KnowledgeService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.UUID;

/**
 * RSocket "train" route — a trainer records an answer (Train mode in the
 * extension): persist a knowledge entry and index it so it immediately answers
 * future questions. Thin; delegates to {@link KnowledgeService}.
 *
 * <p>Today the trainer gate is enforced client-side (the toggle only shows for
 * the trainer role) plus a role check in the background worker. Server-side
 * enforcement arrives with the authenticated channel (thread #4), at which point
 * {@code authoredBy} is derived from the verified principal.
 */
@Controller
class TrainRsocketController {

    private final KnowledgeService knowledgeService;

    TrainRsocketController(KnowledgeService knowledgeService) {
        this.knowledgeService = knowledgeService;
    }

    @MessageMapping("train")
    TrainResult train(TrainRequest request) {
        KnowledgeEntry entry = knowledgeService.train(
            request.question(), request.answer(), request.pageUrl(), request.authoredBy(),
            request.tags() == null ? List.of() : request.tags());
        return new TrainResult(entry.getId(), true);
    }

    /** question: the ask; answer: what to teach; pageUrl: where authored; authoredBy: the trainer; tags: keywords. */
    record TrainRequest(String question, String answer, String pageUrl, String authoredBy, List<String> tags) {}

    record TrainResult(UUID knowledgeEntryId, boolean saved) {}
}
