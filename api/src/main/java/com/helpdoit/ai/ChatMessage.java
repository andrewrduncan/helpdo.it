package com.helpdoit.ai;

import java.util.List;

/**
 * One message in a chat exchange. Framework-neutral. A user message may carry
 * {@link MediaPart media} (e.g. images) alongside its text for multimodal models;
 * system/assistant messages are text-only.
 */
public record ChatMessage(ChatRole role, String content, List<MediaPart> media) {

    public ChatMessage {
        media = media == null ? List.of() : List.copyOf(media);
    }

    /** Text-only message (the common case). */
    public ChatMessage(ChatRole role, String content) {
        this(role, content, List.of());
    }

    public static ChatMessage system(String content) {
        return new ChatMessage(ChatRole.SYSTEM, content);
    }

    public static ChatMessage user(String content) {
        return new ChatMessage(ChatRole.USER, content);
    }

    /** A user message with attached media (images). */
    public static ChatMessage user(String content, List<MediaPart> media) {
        return new ChatMessage(ChatRole.USER, content, media);
    }

    public static ChatMessage assistant(String content) {
        return new ChatMessage(ChatRole.ASSISTANT, content);
    }
}
