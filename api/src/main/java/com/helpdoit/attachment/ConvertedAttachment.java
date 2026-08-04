package com.helpdoit.attachment;

import com.helpdoit.ai.MediaPart;

/**
 * The result of converting one {@link Attachment} into something a model can use:
 * <ul>
 *   <li>{@code IMAGE} — sent inline as a {@link MediaPart} (vision),</li>
 *   <li>{@code TEXT} — extracted text (PDF/Office/text/...) folded into the prompt,</li>
 *   <li>{@code UNSUPPORTED} — a human-readable placeholder noting the file couldn't
 *       be converted (so the model still knows something was attached).</li>
 * </ul>
 * For {@code TEXT}/{@code UNSUPPORTED}, {@link #media} is null and {@link #text} holds
 * the content/placeholder. For {@code IMAGE}, {@link #media} holds the bytes and
 * {@link #text} is null.
 */
public record ConvertedAttachment(String filename, Kind kind, MediaPart media, String text) {

    public enum Kind { IMAGE, TEXT, UNSUPPORTED }

    public boolean isImage() {
        return kind == Kind.IMAGE;
    }

    static ConvertedAttachment image(String filename, MediaPart media) {
        return new ConvertedAttachment(filename, Kind.IMAGE, media, null);
    }

    static ConvertedAttachment text(String filename, String text) {
        return new ConvertedAttachment(filename, Kind.TEXT, null, text);
    }

    static ConvertedAttachment unsupported(String filename, String placeholder) {
        return new ConvertedAttachment(filename, Kind.UNSUPPORTED, null, placeholder);
    }
}
