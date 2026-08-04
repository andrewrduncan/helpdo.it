package com.helpdoit.api;

import com.helpdoit.question.AskResult;
import com.helpdoit.question.QuestionService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

/**
 * RSocket "ask" route — the real retrieve→answer-or-queue flow over the live
 * channel the extension already holds open (mirrors the REST {@link AskController}).
 * Thin: delegates to {@link QuestionService}.
 *
 * <p>{@code askedBy} comes from the request for now; once the channel carries the
 * app JWT it will be derived from the authenticated principal instead.
 */
@Controller
class AskRsocketController {

    private final QuestionService questionService;

    AskRsocketController(QuestionService questionService) {
        this.questionService = questionService;
    }

    @MessageMapping("ask")
    AskResult ask(AskRequest request) {
        return questionService.ask(request.text(), request.pageContext(), request.pageUrl(), request.askedBy());
    }

    /** pageContext: stringified page signals; pageUrl: the page asked on; askedBy: filled from the JWT later. */
    record AskRequest(String text, String pageContext, String pageUrl, String askedBy) {}
}
