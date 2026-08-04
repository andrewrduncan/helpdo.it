package com.helpdoit.ai;

/**
 * The assistant's reply. Kept minimal for now (final text); the adapter runs any
 * tool-calling loop internally. Extend with captured tool calls / token usage
 * when the agent layer needs them (e.g. for tool-call replay).
 */
public record ChatResponse(String content) {}
