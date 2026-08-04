package com.helpdoit.ai.spring;

import com.helpdoit.ai.AiTool;
import com.helpdoit.ai.ChatMessage;
import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.ChatRequest;
import com.helpdoit.ai.ChatResponse;
import com.helpdoit.ai.MediaPart;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.content.Media;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;
import org.springframework.util.MimeType;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * Spring AI implementation of {@link ChatModelPort} for a single provider's
 * {@link ChatModel}. Not a bean itself — {@code AiProvidersConfig} constructs
 * one per enabled provider and the {@code ChatModelRouter} picks between them.
 * The single chat touch-point for Spring AI: maps our neutral messages/tools to
 * Spring AI's and runs the tool-calling loop.
 */
class SpringAiChatAdapter implements ChatModelPort {

    private final ChatClient chatClient;

    SpringAiChatAdapter(ChatModel chatModel) {
        this.chatClient = ChatClient.create(chatModel);
    }

    @Override
    public ChatResponse generate(ChatRequest request) {
        List<Message> messages = request.messages().stream().map(this::toMessage).toList();
        List<ToolCallback> callbacks = request.tools().stream().map(this::toToolCallback).toList();

        ChatClient.ChatClientRequestSpec spec = chatClient.prompt().messages(messages);
        if (!callbacks.isEmpty()) {
            spec = spec.tools(toolSpec -> toolSpec.callbacks(callbacks));
        }
        if (StringUtils.hasText(request.model())) {
            spec = spec.options(ChatOptions.builder().model(request.model()));
        }

        String content = spec.call().content();
        return new ChatResponse(content == null ? "" : content);
    }

    private Message toMessage(ChatMessage m) {
        String content = m.content() == null ? "" : m.content();
        return switch (m.role()) {
            case SYSTEM -> new SystemMessage(content);
            case USER -> m.media().isEmpty()
                ? new UserMessage(content)
                : UserMessage.builder().text(content).media(toMedia(m.media())).build();
            case ASSISTANT -> new AssistantMessage(content);
        };
    }

    /** Map our neutral media parts to Spring AI {@link Media} (inline bytes). */
    private List<Media> toMedia(List<MediaPart> parts) {
        return parts.stream()
            .map(p -> Media.builder()
                .mimeType(MimeType.valueOf(p.mimeType()))
                .data(p.data())
                .build())
            .toList();
    }

    /** Wrap a neutral {@link AiTool} as a Spring AI {@link ToolCallback} (raw JSON in/out). */
    private ToolCallback toToolCallback(AiTool tool) {
        ToolDefinition definition = ToolDefinition.builder()
            .name(tool.name())
            .description(tool.description())
            .inputSchema(tool.inputSchema())
            .build();
        return new ToolCallback() {
            @Override
            public ToolDefinition getToolDefinition() {
                return definition;
            }

            @Override
            public String call(String toolInput) {
                return tool.call(toolInput);
            }
        };
    }
}
