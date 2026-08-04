package com.helpdoit.ai;

/**
 * A non-text part of a chat message — an image (or other binary the model accepts
 * natively) carried inline. Framework-neutral: the adapter maps it to whatever the
 * underlying AI framework uses (Spring AI {@code Media}). Documents that can't be
 * sent as media are converted to text upstream (see {@code com.helpdoit.attachment})
 * and folded into the message text instead — they never become a {@code MediaPart}.
 *
 * @param mimeType the IANA media type, e.g. {@code image/png}
 * @param data     the raw bytes (not base64) — the adapter encodes as the framework needs
 */
public record MediaPart(String mimeType, byte[] data) {

    public MediaPart {
        if (mimeType == null || mimeType.isBlank()) {
            throw new IllegalArgumentException("mimeType is required");
        }
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }
    }
}
