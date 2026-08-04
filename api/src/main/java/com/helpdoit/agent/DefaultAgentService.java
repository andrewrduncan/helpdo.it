package com.helpdoit.agent;

import com.helpdoit.ai.ChatMessage;
import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.ChatRequest;
import com.helpdoit.ai.ChatResponse;
import com.helpdoit.ai.AiTool;
import com.helpdoit.conversation.Conversation;
import com.helpdoit.conversation.ConversationService;
import com.helpdoit.conversation.Message;
import com.helpdoit.conversation.MessageRole;
import com.helpdoit.tool.ToolkitRegistry;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The agent runtime, built entirely on our abstractions — no Spring AI here.
 * One turn = the agent's persona + conversation history + its toolkits, sent
 * through {@link ChatModelPort}; both user and assistant messages are persisted.
 *
 * <p>This is the point of evolving the port: the agent now rides {@code ai}
 * like everything else, so swapping the AI framework touches only the adapter.
 */
@Service
class DefaultAgentService implements AgentService {

    private final ChatModelPort chat;
    private final ConversationService conversations;
    private final AgentRegistry agents;
    private final ToolkitRegistry toolkits;

    DefaultAgentService(ChatModelPort chat,
                        ConversationService conversations,
                        AgentRegistry agents,
                        ToolkitRegistry toolkits) {
        this.chat = chat;
        this.conversations = conversations;
        this.agents = agents;
        this.toolkits = toolkits;
    }

    @Override
    public AgentReply respond(UUID conversationId, String userMessage) {
        Conversation conversation = conversations.require(conversationId);
        String slug = conversation.getAgentSlug() == null ? "helper" : conversation.getAgentSlug();
        AgentDefinition agent = agents.require(slug);

        // Build the exchange: persona, prior history, then this user turn.
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(ChatMessage.system(agent.getSystemPrompt()));
        for (Message m : conversations.history(conversationId)) {
            messages.add(new ChatMessage(toChatRole(m.getRole()), m.getContent()));
        }
        conversations.append(conversationId, MessageRole.USER, userMessage, null);
        messages.add(ChatMessage.user(userMessage));

        List<AiTool> tools = toolkits.resolve(agent.getToolkits());

        // provider = null → router uses the globally-selected provider. (Per-agent
        // provider can be added to AgentDefinition later, passed here.)
        ChatResponse response = chat.generate(new ChatRequest(messages, tools, agent.getModel(), null));

        Message assistant = conversations.append(
            conversationId, MessageRole.ASSISTANT, response.content(), null);
        return new AgentReply(assistant.getId(), response.content());
    }

    private static com.helpdoit.ai.ChatRole toChatRole(MessageRole role) {
        return switch (role) {
            case USER -> com.helpdoit.ai.ChatRole.USER;
            case ASSISTANT -> com.helpdoit.ai.ChatRole.ASSISTANT;
            case SYSTEM -> com.helpdoit.ai.ChatRole.SYSTEM;
        };
    }
}
