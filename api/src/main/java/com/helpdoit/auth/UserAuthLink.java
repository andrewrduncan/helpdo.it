package com.helpdoit.auth;

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

/** Links an external identity (provider + key) to an {@link AppUser}. */
@Entity
@Table(name = "user_auth_link")
@Getter
@Setter
public class UserAuthLink {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** e.g. "google", "microsoft", "github". */
    @Column(nullable = false)
    private String provider;

    /** The provider's stable subject id for this user. */
    @Column(name = "provider_key", nullable = false)
    private String providerKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
