package com.helpdoit.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Roles: resolve a user's effective role keys, and (on login) grant roles from
 * configured claim mappings. Role keys are stamped onto the app JWT so the rest
 * of the system — including the extension — trusts only that token.
 */
@Service
public class RoleService {

    private static final Logger log = LoggerFactory.getLogger(RoleService.class);

    private final RoleRepository roles;
    private final UserRoleRepository userRoles;
    private final RoleClaimMappingRepository mappings;

    public RoleService(RoleRepository roles, UserRoleRepository userRoles, RoleClaimMappingRepository mappings) {
        this.roles = roles;
        this.userRoles = userRoles;
        this.mappings = mappings;
    }

    /** The user's effective role keys (e.g. {"trainer"}). */
    @Transactional(readOnly = true)
    public Set<String> rolesFor(UUID userId) {
        return userRoles.findByUserId(userId).stream()
            .map(ur -> roles.findById(ur.getRoleId()))
            .flatMap(Optional::stream)
            .map(Role::getRoleKey)
            .collect(Collectors.toSet());
    }

    /**
     * Grant any roles whose claim mapping matches this login's claims. Idempotent —
     * a no-op when no mappings are configured (the current default).
     */
    @Transactional
    public void applyClaimMappings(UUID userId, Map<String, Object> claims) {
        for (RoleClaimMapping m : mappings.findAll()) {
            if (matches(claims.get(m.getClaim()), m.getClaimValue())) {
                grant(userId, m.getRoleId());
            }
        }
    }

    /**
     * Lockout safety / first-user bootstrap: if the system has no admin yet, grant
     * admin to this user. Runs on every login; a no-op once an admin exists.
     */
    @Transactional
    public void bootstrapAdminIfNone(UUID userId) {
        roles.findByRoleKey("admin").ifPresent(admin -> {
            if (!userRoles.existsByRoleId(admin.getId())) {
                grant(userId, admin.getId());
                log.info("Bootstrapped first admin: user {}", userId);
            }
        });
    }

    /** Assign a role (by key) to a user — admin action. */
    @Transactional
    public void assign(UUID userId, String roleKey) {
        Role role = roles.findByRoleKey(roleKey)
            .orElseThrow(() -> new IllegalArgumentException("Unknown role: " + roleKey));
        grant(userId, role.getId());
    }

    /** Remove a role (by key) from a user — admin action. */
    @Transactional
    public void revoke(UUID userId, String roleKey) {
        Role role = roles.findByRoleKey(roleKey)
            .orElseThrow(() -> new IllegalArgumentException("Unknown role: " + roleKey));
        userRoles.deleteByUserIdAndRoleId(userId, role.getId());
    }

    /** Grant a role to a user if not already granted. */
    @Transactional
    public void grant(UUID userId, UUID roleId) {
        if (!userRoles.existsByUserIdAndRoleId(userId, roleId)) {
            UserRole grant = new UserRole();
            grant.setUserId(userId);
            grant.setRoleId(roleId);
            userRoles.save(grant);
            log.debug("Granted role {} to user {}", roleId, userId);
        }
    }

    /** A scalar claim equal to the wanted value, or a collection claim containing it. */
    private static boolean matches(Object claimValue, String wanted) {
        if (claimValue == null) {
            return false;
        }
        if (claimValue instanceof Collection<?> c) {
            return c.stream().anyMatch(v -> wanted.equals(String.valueOf(v)));
        }
        return wanted.equals(String.valueOf(claimValue));
    }
}
