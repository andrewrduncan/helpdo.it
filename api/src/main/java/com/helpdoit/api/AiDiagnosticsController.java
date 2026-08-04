package com.helpdoit.api;

import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.ChatPrompt;
import com.helpdoit.ai.EmbeddingPort;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Dev smoke-test for the AI wiring. Talks ONLY through the framework-agnostic
 * ports ({@link EmbeddingPort}, {@link ChatModelPort}) — never Spring AI — so a
 * green response here also demonstrates that domain code is fully decoupled
 * from the underlying framework.
 *
 * <p>These endpoints make real (paid) provider calls, so they need a valid
 * OPENROUTER_API_KEY. Intended for local verification, not production exposure.
 */
@RestController
@RequestMapping("/api/ai")
class AiDiagnosticsController {

    private final EmbeddingPort embedding;
    private final ChatModelPort chat;

    AiDiagnosticsController(EmbeddingPort embedding, ChatModelPort chat) {
        this.embedding = embedding;
        this.chat = chat;
    }

    /** Embeds a fixed string and reports the vector shape — cheap check of the embedding path. */
    @GetMapping("/ping")
    EmbeddingInfo ping() {
        float[] vector = embedding.embed("helpdo.it embedding smoke test");
        return new EmbeddingInfo(embedding.dimensions(), vector.length);
    }

    /** Round-trips a question through the chat model — checks the chat path. */
    @PostMapping("/ask")
    ChatReply ask(@RequestBody AskRequest request) {
        String reply = chat.complete(new ChatPrompt(
            "You are helpdo.it's assistant. Answer concisely.",
            request.question()));
        return new ChatReply(reply);
    }

    record EmbeddingInfo(int reportedDimensions, int actualVectorLength) {}
    record AskRequest(String question) {}
    record ChatReply(String reply) {}
}
