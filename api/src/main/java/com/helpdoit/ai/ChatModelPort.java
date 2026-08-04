package com.helpdoit.ai;

import java.util.ArrayList;
import java.util.List;

/**
 * Framework-agnostic chat port.
 *
 * <p>Domain code — including the agent runtime — depends only on this
 * interface, never on Spring AI. The concrete implementation lives in an adapter
 * package ({@code com.helpdoit.ai.spring}); swapping the underlying framework or
 * provider means providing a different adapter, with no change above this line.
 *
 * <p>{@link #generate} is the full exchange (message history + tools + optional
 * model) the agents need; {@link #complete} is a convenience for one-shot
 * prompts, built on top of it.
 */
public interface ChatModelPort {

    /** Run a chat exchange — history, tools, and any tool-calling loop — and return the reply. */
    ChatResponse generate(ChatRequest request);

    /** Convenience: a single system+user prompt with no tools (default model). */
    default String complete(ChatPrompt prompt) {
        return complete(prompt, List.of(), null);
    }

    /** Convenience: a one-shot prompt on a specific model (null/blank = the configured default). */
    default String complete(ChatPrompt prompt, String model) {
        return complete(prompt, List.of(), model);
    }

    /** Convenience: a system+user prompt whose user turn carries media (images), default model. */
    default String complete(ChatPrompt prompt, List<MediaPart> media) {
        return complete(prompt, media, null);
    }

    /** Convenience: a system+user prompt with media, on a specific model (null/blank = default). */
    default String complete(ChatPrompt prompt, List<MediaPart> media, String model) {
        List<ChatMessage> messages = new ArrayList<>();
        if (prompt.system() != null && !prompt.system().isBlank()) {
            messages.add(ChatMessage.system(prompt.system()));
        }
        messages.add(ChatMessage.user(prompt.user(), media));
        return generate(new ChatRequest(messages, List.of(), model, null)).content();
    }
}
