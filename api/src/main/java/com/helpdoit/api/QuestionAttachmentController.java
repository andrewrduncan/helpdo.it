package com.helpdoit.api;

import com.helpdoit.auth.RoleService;
import com.helpdoit.question.QuestionAttachment;
import com.helpdoit.question.QuestionAttachmentRepository;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Base64;
import java.util.UUID;

/**
 * Serves the raw bytes of an image attachment for the queue (the GraphQL view only
 * carries metadata). Trainer/admin only — attachments may contain whatever a user
 * captured. Document attachments expose their extracted text via GraphQL instead.
 */
@RestController
@RequestMapping("/api")
class QuestionAttachmentController {

    private final QuestionAttachmentRepository attachments;
    private final RoleService roleService;

    QuestionAttachmentController(QuestionAttachmentRepository attachments, RoleService roleService) {
        this.attachments = attachments;
        this.roleService = roleService;
    }

    @GetMapping("/questions/{questionId}/attachments/{id}")
    ResponseEntity<byte[]> image(@PathVariable String questionId, @PathVariable String id,
                                 @AuthenticationPrincipal Jwt jwt) {
        requireManager(jwt);
        QuestionAttachment a = attachments.findById(UUID.fromString(id)).orElse(null);
        if (a == null || !a.getQuestionId().equals(UUID.fromString(questionId)) || a.getImage() == null) {
            return ResponseEntity.notFound().build();
        }
        byte[] bytes = Base64.getDecoder().decode(a.getImage());
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(a.getContentType()))
            .body(bytes);
    }

    /**
     * Store the page snapshot taken when a question was asked, as an image attachment
     * on the question — context for the trainer (and the AI, if it later resolves it).
     * Any authenticated asker may post it; viewing the bytes stays trainer/admin-gated.
     */
    @PostMapping("/questions/{questionId}/screenshot")
    void screenshot(@PathVariable String questionId, @RequestBody Snapshot body,
                    @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            throw new AccessDeniedException("Authentication required");
        }
        if (body == null || body.image() == null || body.image().isBlank()) {
            return;
        }
        QuestionAttachment a = new QuestionAttachment();
        a.setQuestionId(UUID.fromString(questionId));
        a.setFilename("page-snapshot.jpg");
        a.setContentType(body.contentType() == null || body.contentType().isBlank() ? "image/jpeg" : body.contentType());
        a.setKind("image");
        a.setImage(body.image());
        attachments.save(a);
    }

    record Snapshot(String image, String contentType) {}

    private void requireManager(Jwt jwt) {
        if (jwt == null) {
            throw new AccessDeniedException("Authentication required");
        }
        var roles = roleService.rolesFor(UUID.fromString(jwt.getSubject()));
        if (!roles.contains("admin") && !roles.contains("trainer")) {
            throw new AccessDeniedException("Trainer or admin role required");
        }
    }
}
