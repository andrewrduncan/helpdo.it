package com.helpdoit.walkthrough;

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
 * A recorded walkthrough — an ordered, typed step sequence captured in Train mode
 * that answers a question and can be replayed to guide a user. Created at
 * record-start (status 'recording'), steps appended as they stream in, finalized
 * on Stop (status 'ready', linked to the authored {@code knowledge_entry}).
 */
@Entity
@Table(name = "walkthrough")
@Getter
@Setter
public class Walkthrough {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** The question this walkthrough answers (when started from the queue). */
    @Column(name = "question_id")
    private UUID questionId;

    /** The knowledge entry authored from this walkthrough (set on finalize). */
    @Column(name = "knowledge_entry_id")
    private UUID knowledgeEntryId;

    @Column(nullable = false)
    private String status = "recording"; // recording | ready

    /** Ordered typed steps as a JSON array — each {type, ...}. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String steps = "[]";

    @Column(name = "capture_screens", nullable = false)
    private boolean captureScreens = true;

    @Column(name = "created_by")
    private String createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
