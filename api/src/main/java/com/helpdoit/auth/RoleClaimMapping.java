package com.helpdoit.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Maps an OIDC/JWT claim value to a role, e.g. {@code (email, you@corp.com) -> trainer}
 * or {@code (groups, <entra-group-id>) -> admin}. Evaluated on every login.
 */
@Entity
@Table(name = "role_claim_mapping")
@Getter
@Setter
public class RoleClaimMapping {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** Claim name as it appears in the provider's attributes (e.g. "email", "hd", "groups"). */
    @Column(nullable = false)
    private String claim;

    /** Value to match — a scalar, or one element of a collection claim (e.g. groups). */
    @Column(name = "claim_value", nullable = false)
    private String claimValue;

    @Column(name = "role_id", nullable = false)
    private UUID roleId;
}
