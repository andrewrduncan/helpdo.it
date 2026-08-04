package com.helpdoit.api;

import com.helpdoit.attachment.Attachment;
import com.helpdoit.question.AskResult;
import com.helpdoit.question.QuestionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Ask a question: retrieve from the knowledge corpus and either answer or queue.
 * Two forms:
 * <ul>
 *   <li>JSON {@code /api/ask} — the plain text ask (mirrors the RSocket route).</li>
 *   <li>multipart {@code /api/ask} — the ask <em>with file attachments</em>. Files
 *       can't ride the RSocket channel (its WS frames cap ~64 KB), so the extension
 *       posts them here. Gated by the central {@code helpdoit.attachments.enabled}
 *       flag; {@code askedBy} is derived from the bearer JWT.</li>
 * </ul>
 * Thin — delegates to {@link QuestionService}.
 */
@RestController
@RequestMapping("/api")
class AskController {

    private final QuestionService questionService;
    private final boolean attachmentsEnabled;

    AskController(QuestionService questionService,
                  @Value("${helpdoit.attachments.enabled:true}") boolean attachmentsEnabled) {
        this.questionService = questionService;
        this.attachmentsEnabled = attachmentsEnabled;
    }

    @PostMapping(value = "/ask", consumes = MediaType.APPLICATION_JSON_VALUE)
    AskResult ask(@RequestBody AskRequest request) {
        return questionService.ask(request.text(), request.pageContext(), request.pageUrl(), request.askedBy());
    }

    @PostMapping(value = "/ask", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    AskResult askWithFiles(
            @RequestParam("text") String text,
            @RequestParam(value = "pageUrl", required = false) String pageUrl,
            @RequestParam(value = "pageContext", required = false) String pageContext,
            @RequestPart(value = "files", required = false) List<MultipartFile> files,
            @AuthenticationPrincipal Jwt jwt) throws IOException {
        if (!attachmentsEnabled) {
            throw new AccessDeniedException("Attachments are disabled for this instance");
        }
        return questionService.ask(text, pageContext, pageUrl, askedBy(jwt), toAttachments(files));
    }

    /** Server-derived asker (channel/HTTP carries the JWT). Falls back to email. */
    private static String askedBy(Jwt jwt) {
        if (jwt == null) {
            return null;
        }
        String name = jwt.getClaimAsString("name");
        return (name != null && !name.isBlank()) ? name : jwt.getClaimAsString("email");
    }

    private static List<Attachment> toAttachments(List<MultipartFile> files) throws IOException {
        List<Attachment> out = new ArrayList<>();
        if (files != null) {
            for (MultipartFile f : files) {
                if (f != null && !f.isEmpty()) {
                    out.add(new Attachment(f.getOriginalFilename(), f.getContentType(), f.getBytes()));
                }
            }
        }
        return out;
    }

    /** pageContext: raw JSON captured by the extension; pageUrl: the page asked on; askedBy: the user (from the JWT later). */
    record AskRequest(String text, String pageContext, String pageUrl, String askedBy) {}
}
