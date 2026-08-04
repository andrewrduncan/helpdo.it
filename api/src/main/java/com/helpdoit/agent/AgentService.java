package com.helpdoit.agent;

import java.util.UUID;

/**
 * Runs one agent turn against a conversation: loads the conversation's agent
 * definition + history, calls the model with the agent's toolkits, and persists
 * both the user and assistant messages.
 *
 * <p>Framework-neutral by design — the Spring AI implementation lives in
 * {@code com.helpdoit.agent.spring}, mirroring the AI ports/adapters split.
 */
public interface AgentService {

    AgentReply respond(UUID conversationId, String userMessage);
}
