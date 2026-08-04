package com.helpdoit.knowledge;

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

/** A unit of trained knowledge / admin-authored answer — the RAG corpus. */
@Entity
@Table(name = "knowledge_entry")
@Getter
@Setter
public class KnowledgeEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String content;

    /** Where it came from: 'training' | 'admin-answer' | ... */
    private String source;

    @Column(nullable = false)
    private String status = "active"; // active | retired

    /** The domain (page hostname) this entry belongs to; search is scoped to it. */
    @Column(name = "domain_id")
    private UUID domainId;

    @JdbcTypeCode(SqlTypes.JSON)
    private String metadata;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
