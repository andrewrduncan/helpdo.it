package com.helpdoit.attachment;

import com.helpdoit.ai.MediaPart;
import org.apache.tika.Tika;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Turns an uploaded {@link Attachment} into model-ready content, mirroring the
 * approach proven in promptly.do: images go to the model inline (vision); documents
 * are extracted to text; anything else degrades to a placeholder so the model still
 * knows a file was attached.
 *
 * <ul>
 *   <li><b>Images</b> the model takes natively (png/jpeg/gif/webp) pass through as a
 *       {@link MediaPart}. Other raster images are transcoded to PNG via ImageIO;
 *       if that fails (e.g. SVG, which ImageIO can't raster) they fall back to text.</li>
 *   <li><b>Documents</b> (PDF, Office, RTF, HTML, CSV, JSON, plain text, ...) are run
 *       through Apache Tika's text extraction (Tika bundles PDFBox + POI).</li>
 *   <li><b>Everything else</b> (audio, video, archives, unknown binaries) → placeholder.</li>
 * </ul>
 *
 * MIME type is taken from the client when specific, else sniffed by Tika.
 */
@Service
public class AttachmentConverter {

    private static final Logger log = LoggerFactory.getLogger(AttachmentConverter.class);

    /** Image types models accept inline as-is — no transcode needed. */
    private static final Set<String> NATIVE_IMAGE_TYPES =
        Set.of("image/png", "image/jpeg", "image/gif", "image/webp");

    private static final Tika TIKA = new Tika();

    private final long maxBytes;
    private final int maxTextChars;

    public AttachmentConverter(
            @Value("${helpdoit.attachments.max-bytes:20971520}") long maxBytes,       // 20 MB
            @Value("${helpdoit.attachments.max-text-chars:20000}") int maxTextChars) {
        this.maxBytes = maxBytes;
        this.maxTextChars = maxTextChars;
    }

    /** Prompt text (original + any extracted document text) plus image media for the model. */
    public record Prepared(String text, List<MediaPart> media) {}

    /**
     * Convert a batch of attachments and fold them into a model turn: extracted
     * document text (and any placeholders) are appended under the prompt; images
     * become {@link MediaPart media}. Returns the assembled text + media list.
     */
    public Prepared prepare(String prompt, List<Attachment> attachments) {
        List<MediaPart> media = new ArrayList<>();
        StringBuilder text = new StringBuilder(prompt == null ? "" : prompt);
        if (attachments != null) {
            for (Attachment att : attachments) {
                ConvertedAttachment c = convert(att);
                switch (c.kind()) {
                    case IMAGE -> media.add(c.media());
                    case TEXT -> text.append("\n\n--- Attached file: ").append(c.filename())
                        .append(" ---\n").append(c.text());
                    case UNSUPPORTED -> text.append("\n\n").append(c.text());
                }
            }
        }
        return new Prepared(text.toString(), media);
    }

    /** Convert a single attachment. Never throws — failures degrade to a placeholder. */
    public ConvertedAttachment convert(Attachment att) {
        String name = att.filename() == null || att.filename().isBlank() ? "file" : att.filename();
        byte[] data = att.data();
        if (data == null || data.length == 0) {
            return ConvertedAttachment.unsupported(name, placeholder(name, "empty", 0));
        }
        if (data.length > maxBytes) {
            return ConvertedAttachment.unsupported(name,
                placeholder(name, "exceeds the " + (maxBytes / (1024 * 1024)) + " MB limit", data.length));
        }

        String type = resolveType(att.contentType(), data, name);

        if (type.startsWith("image/")) {
            return convertImage(name, type, data);
        }
        return convertDocument(name, type, data);
    }

    private ConvertedAttachment convertImage(String name, String type, byte[] data) {
        if (NATIVE_IMAGE_TYPES.contains(type)) {
            return ConvertedAttachment.image(name, new MediaPart(type, data));
        }
        // Exotic raster (bmp/tiff/...) → transcode to PNG so any vision model accepts it.
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(data));
            if (img != null) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                if (ImageIO.write(img, "png", out)) {
                    return ConvertedAttachment.image(name, new MediaPart("image/png", out.toByteArray()));
                }
            }
        } catch (Exception e) {
            log.debug("Image transcode failed for {} ({})", name, type, e);
        }
        // SVG and friends: ImageIO can't raster them — try extracting as text instead.
        return convertDocument(name, type, data);
    }

    private ConvertedAttachment convertDocument(String name, String type, byte[] data) {
        try {
            String text = TIKA.parseToString(new ByteArrayInputStream(data));
            if (text != null && !text.isBlank()) {
                return ConvertedAttachment.text(name, truncate(text.strip()));
            }
        } catch (Exception e) {
            log.debug("Text extraction failed for {} ({})", name, type, e);
        }
        return ConvertedAttachment.unsupported(name, placeholder(name, "unsupported type " + type, data.length));
    }

    /** Trust a specific client type; otherwise sniff the bytes (Tika). */
    private String resolveType(String declared, byte[] data, String name) {
        if (declared != null && !declared.isBlank()
                && !"application/octet-stream".equalsIgnoreCase(declared.trim())) {
            return declared.trim().toLowerCase();
        }
        try {
            return TIKA.detect(data, name).toLowerCase();
        } catch (Exception e) {
            return "application/octet-stream";
        }
    }

    private String truncate(String s) {
        return s.length() <= maxTextChars ? s : s.substring(0, maxTextChars) + "\n…[truncated]";
    }

    private static String placeholder(String name, String reason, long bytes) {
        return "[Attachment \"" + name + "\" (" + bytes + " bytes) — " + reason + "; not included]";
    }
}
