package com.helpdoit.ai;

import java.util.List;

/**
 * A chat completion request: the full message history, the tools the model may
 * call, and an optional model override (null = the configured default).
 *
 * <p>This is what lets the agent runtime ride the port instead of Spring AI:
 * everything an agent turn needs — history + tools + model + provider — is
 * expressed here. {@code provider} is an optional per-request override; null
 * means "use the globally-selected provider" ({@link ProviderSelector}).
 */
public record ChatRequest(List<ChatMessage> messages, List<AiTool> tools, String model, Provider provider) {

    public ChatRequest {
        messages = messages == null ? List.of() : List.copyOf(messages);
        tools = tools == null ? List.of() : List.copyOf(tools);
    }
}
