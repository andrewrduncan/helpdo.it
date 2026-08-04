package com.helpdoit.ai;

/**
 * A framework-neutral chat prompt: an optional system instruction plus the user
 * message. RAG assembly (stuffing retrieved knowledge into the prompt) happens
 * in domain services above the port, not here — keeping this DTO simple and
 * independent of any AI framework's message model.
 *
 * @param system optional system/developer instruction; may be {@code null} or blank
 * @param user   the user message
 */
public record ChatPrompt(String system, String user) {

    /** Convenience for a user-only prompt with no system instruction. */
    public static ChatPrompt ofUser(String user) {
        return new ChatPrompt(null, user);
    }
}
