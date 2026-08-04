package com.helpdoit.agent;

import java.util.UUID;

/** The assistant's reply to a turn: the persisted message id and its text. */
public record AgentReply(UUID messageId, String content) {}
