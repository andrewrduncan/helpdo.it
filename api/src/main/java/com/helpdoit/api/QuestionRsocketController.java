package com.helpdoit.api;

import com.helpdoit.question.QuestionRepository;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.util.UUID;

/**
 * RSocket "question" route — look up a single question by id so the extension can
 * prefill Train mode from a deep-link (#helpdoit=&lt;id&gt;). Returns a lightweight
 * view; empty text if the id is unknown.
 */
@Controller
class QuestionRsocketController {

    private final QuestionRepository questions;

    QuestionRsocketController(QuestionRepository questions) {
        this.questions = questions;
    }

    @MessageMapping("question")
    QuestionView question(LookupRequest request) {
        return questions.findById(UUID.fromString(request.id()))
            .map(q -> new QuestionView(q.getId().toString(), q.getText(), q.getPageUrl(), q.getStatus()))
            .orElse(new QuestionView(request.id(), "", null, null));
    }

    record LookupRequest(String id) {}

    record QuestionView(String id, String text, String pageUrl, String status) {}
}
