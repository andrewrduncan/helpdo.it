package com.helpdoit.attachment;

/**
 * A file handed in for conversion: raw bytes plus the client-declared filename and
 * content type. The content type is a hint — {@link AttachmentConverter} sniffs the
 * real type when it's missing or generic ({@code application/octet-stream}).
 */
public record Attachment(String filename, String contentType, byte[] data) {}
