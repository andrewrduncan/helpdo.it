package com.helpdoit.api;

import com.helpdoit.auth.RoleService;
import com.helpdoit.question.Question;
import com.helpdoit.question.QuestionAttachment;
import com.helpdoit.question.QuestionAttachmentRepository;
import com.helpdoit.question.QuestionRepository;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Controller;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.UUID;

/** GraphQL reads + queue management for the Question Queue admin page. */
@Controller
class QuestionQueryController {

    private final QuestionRepository repository;
    private final QuestionAttachmentRepository attachments;
    private final RoleService roleService;

    QuestionQueryController(QuestionRepository repository, QuestionAttachmentRepository attachments,
                            RoleService roleService) {
        this.repository = repository;
        this.attachments = attachments;
        this.roleService = roleService;
    }

    @QueryMapping
    List<Question> questions(@Argument String status, @Argument String domainId) {
        boolean hasDomain = StringUtils.hasText(domainId);
        boolean hasStatus = StringUtils.hasText(status);
        if (hasDomain) {
            UUID d = UUID.fromString(domainId);
            return hasStatus
                ? repository.findByDomainIdAndStatusOrderByCreatedAtDesc(d, status)
                : repository.findByDomainIdOrderByCreatedAtDesc(d);
        }
        return hasStatus
            ? repository.findByStatusOrderByCreatedAtDesc(status)
            : repository.findAllByOrderByCreatedAtDesc();
    }

    /** Attachments a user added to a question (image bytes are fetched over REST, not here). */
    @SchemaMapping(typeName = "Question")
    List<AttachmentView> attachments(Question question) {
        return attachments.findByQuestionIdOrderByCreatedAtAsc(question.getId()).stream()
            .map(QuestionQueryController::toView)
            .toList();
    }

    private static AttachmentView toView(QuestionAttachment a) {
        String preview = a.getExtractedText() == null ? null
            : a.getExtractedText().substring(0, Math.min(280, a.getExtractedText().length()));
        return new AttachmentView(a.getId().toString(), a.getFilename(), a.getContentType(),
            a.getKind(), "image".equals(a.getKind()), preview);
    }

    /** GraphQL view of an attachment. {@code hasImage} → fetch bytes from the REST endpoint. */
    record AttachmentView(String id, String filename, String contentType, String kind,
                          boolean hasImage, String textPreview) {}

    @MutationMapping
    boolean deleteQuestion(@Argument String id, @AuthenticationPrincipal Jwt jwt) {
        requireQueueManager(jwt);
        repository.deleteById(UUID.fromString(id));
        return true;
    }

    /** Managing the queue is the trainer's job (and admins can do anything). Live DB roles. */
    private void requireQueueManager(Jwt jwt) {
        if (jwt == null) {
            throw new AccessDeniedException("Authentication required");
        }
        var roles = roleService.rolesFor(UUID.fromString(jwt.getSubject()));
        if (!roles.contains("admin") && !roles.contains("trainer")) {
            throw new AccessDeniedException("Trainer or admin role required");
        }
    }
}
