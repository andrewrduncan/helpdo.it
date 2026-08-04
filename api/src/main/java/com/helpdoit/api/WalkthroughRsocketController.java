package com.helpdoit.api;

import com.helpdoit.walkthrough.Walkthrough;
import com.helpdoit.walkthrough.WalkthroughService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * RSocket recording routes for Train mode. The extension streams a recording:
 * {@code train-start} → one {@code train-step} per click/navigation → {@code train-stop}.
 * Thin; delegates to {@link WalkthroughService}.
 */
@Controller
class WalkthroughRsocketController {

    private final WalkthroughService service;

    WalkthroughRsocketController(WalkthroughService service) {
        this.service = service;
    }

    @MessageMapping("train-start")
    StartResult start(StartRequest request) {
        UUID questionId = (request.questionId() == null || request.questionId().isBlank())
            ? null : UUID.fromString(request.questionId());
        Walkthrough w = service.start(questionId, request.captureScreens(), request.createdBy());
        return new StartResult(w.getId().toString());
    }

    @MessageMapping("train-step")
    StepResult step(StepRequest request) {
        int count = service.appendStep(UUID.fromString(request.walkthroughId()), request.step());
        return new StepResult(count);
    }

    @MessageMapping("train-stop")
    StopResult stop(StopRequest request) {
        WalkthroughService.DraftResult draft = service.summarize(
            UUID.fromString(request.walkthroughId()), request.question());
        return new StopResult(draft.walkthroughId().toString(), draft.status(),
            draft.answer(), draft.stepsJson(), draft.stepCount());
    }

    @MessageMapping("train-save")
    SaveResult save(SaveRequest request) {
        WalkthroughService.SaveResult result = service.save(
            UUID.fromString(request.walkthroughId()),
            request.question(),
            request.tags() == null ? List.of() : request.tags(),
            request.answer(),
            request.steps());
        return new SaveResult(
            result.walkthroughId().toString(),
            result.status(),
            result.knowledgeEntryId() == null ? null : result.knowledgeEntryId().toString(),
            result.stepCount());
    }

    @MessageMapping("train-resummarize")
    ResummarizeResult resummarize(ResummarizeRequest request) {
        return new ResummarizeResult(service.resummarize(request.question(), request.steps()));
    }

    record StartRequest(String questionId, boolean captureScreens, String createdBy) {}
    record StartResult(String walkthroughId) {}

    /** step: a typed step object ({type, target, url, ...}). Screenshots upload over HTTP. */
    record StepRequest(String walkthroughId, Map<String, Object> step) {}
    record StepResult(int stepCount) {}

    /** Stop summarizes the recording into a review draft (no authoring yet). */
    record StopRequest(String walkthroughId, String question) {}
    record StopResult(String walkthroughId, String status, String answer, String steps, int stepCount) {}

    /** Save authors the reviewed walkthrough: edited question/tags/answer + (edited) steps JSON. */
    record SaveRequest(String walkthroughId, String question, List<String> tags, String answer, String steps) {}
    record SaveResult(String walkthroughId, String status, String knowledgeEntryId, int stepCount) {}

    /** Regenerate the answer from edited step captions (review editor). */
    record ResummarizeRequest(String question, String steps) {}
    record ResummarizeResult(String answer) {}
}
