package com.helpdoit.question;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A file a user attached to a question. Images keep their bytes (base64) so a
 * trainer can view them in the queue; documents are extracted to text (Tika) and
 * only the {@code extractedText} is kept. {@code kind} mirrors
 * {@code AttachmentConverter}: image | text | unsupported.
 */
@Entity
@Table(name = "question_attachment")
@Getter
@Setter
public class QuestionAttachment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "question_id", nullable = false)
    private UUID questionId;

    @Column(nullable = false)
    private String filename;

    @Column(name = "content_type", nullable = false)
    private String contentType;

    @Column(nullable = false)
    private String kind; // image | text | unsupported

    /** base64 image payload (kind=image only). */
    @Column
    private String image;

    @Column(name = "extracted_text")
    private String extractedText;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
