package com.helpdoit.api;

import com.helpdoit.agent.AgentReply;
import com.helpdoit.agent.AgentService;
import com.helpdoit.conversation.Conversation;
import com.helpdoit.conversation.ConversationService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * REST surface for the agent/chat building blocks — start a conversation, send
 * a message (runs the agent turn), read history. This is the endpoint the
 * extension will eventually call instead of its mocked answer.
 *
 * <p>{@code POST /messages} makes a real provider call, so it needs a key.
 */
@RestController
@RequestMapping("/api/agent")
class AgentChatController {

    private final ConversationService conversations;
    private final AgentService agentService;

    AgentChatController(ConversationService conversations, AgentService agentService) {
        this.conversations = conversations;
        this.agentService = agentService;
    }

    @PostMapping("/conversations")
    StartResponse start(@RequestBody(required = false) StartRequest request) {
        String agentSlug = request != null && request.agentSlug() != null ? request.agentSlug() : "helper";
        String title = request != null ? request.title() : null;
        Conversation c = conversations.start(agentSlug, title);
        return new StartResponse(c.getId(), c.getAgentSlug());
    }

    @PostMapping("/conversations/{id}/messages")
    AgentReply send(@PathVariable UUID id, @RequestBody SendRequest request) {
        return agentService.respond(id, request.message());
    }

    @GetMapping("/conversations/{id}/messages")
    List<MessageView> history(@PathVariable UUID id) {
        return conversations.history(id).stream()
            .map(m -> new MessageView(m.getId(), m.getRole().name(), m.getContent(), m.getCreatedAt()))
            .toList();
    }

    record StartRequest(String agentSlug, String title) {}
    record StartResponse(UUID conversationId, String agentSlug) {}
    record SendRequest(String message) {}
    record MessageView(UUID id, String role, String content, OffsetDateTime createdAt) {}
}
