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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A user question with its captured page context. The admin queue is the subset
 * with status 'queued'. When resolved, {@code answeredByEntry} links to the
 * {@code knowledge_entry} that answers it.
 */
@Entity
@Table(name = "question")
@Getter
@Setter
public class Question {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String text;

    /** Raw JSON captured by the extension (url, title, DOM/selectors, ...). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "page_context")
    private String pageContext;

    /** The page the question was asked on — elevated from page_context for filtering. */
    @Column(name = "page_url")
    private String pageUrl;

    @Column(name = "screen_capture_ref")
    private String screenCaptureRef;

    /** The domain (page hostname) this question was asked on; set at ask-time. */
    @Column(name = "domain_id")
    private UUID domainId;

    @Column(nullable = false)
    private String status = "queued"; // queued | answered | resolved

    @Column(name = "answered_by_entry")
    private UUID answeredByEntry;

    @Column(name = "asked_by")
    private String askedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
