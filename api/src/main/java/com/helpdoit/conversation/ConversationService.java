package com.helpdoit.conversation;

import com.helpdoit.graphql.error.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Owns conversation + message persistence. The agent runtime calls into this;
 * it never touches the repositories directly.
 */
@Service
public class ConversationService {

    private final ConversationRepository conversations;
    private final MessageRepository messages;

    public ConversationService(ConversationRepository conversations, MessageRepository messages) {
        this.conversations = conversations;
        this.messages = messages;
    }

    @Transactional
    public Conversation start(String agentSlug, String title) {
        Conversation c = new Conversation();
        c.setAgentSlug(agentSlug);
        c.setTitle(title);
        return conversations.save(c);
    }

    @Transactional(readOnly = true)
    public Conversation require(UUID conversationId) {
        return conversations.findById(conversationId)
            .orElseThrow(() -> new NotFoundException("Conversation " + conversationId));
    }

    @Transactional(readOnly = true)
    public List<Message> history(UUID conversationId) {
        return messages.findByConversationIdOrderByCreatedAtAsc(conversationId);
    }

    @Transactional
    public Message append(UUID conversationId, MessageRole role, String content, String toolCalls) {
        Message m = new Message();
        m.setConversationId(conversationId);
        m.setRole(role);
        m.setContent(content);
        m.setToolCalls(toolCalls);
        return messages.save(m);
    }
}
