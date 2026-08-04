package com.helpdoit.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A domain — one per page hostname (e.g. {@code app.example.com}).
 * Knowledge entries are partitioned by domain and search is scoped to it. Domains
 * are registered implicitly: the first entry trained on a host creates its domain.
 */
@Entity
@Table(name = "domain")
@Getter
@Setter
public class Domain {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** The hostname this domain represents (unique, lowercased, no port). */
    @Column(nullable = false, unique = true)
    private String host;

    /** Optional display label; the UI falls back to {@link #host} when null. */
    private String name;

    @Column(nullable = false)
    private String status = "active"; // active | retired

    /** Identity of the trainer whose first entry registered this domain. */
    @Column(name = "created_by")
    private String createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
