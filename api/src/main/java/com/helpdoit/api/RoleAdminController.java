package com.helpdoit.api;

import com.helpdoit.auth.AppUser;
import com.helpdoit.auth.AppUserRepository;
import com.helpdoit.auth.Role;
import com.helpdoit.auth.RoleRepository;
import com.helpdoit.auth.RoleService;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.UUID;

/**
 * Admin: users and their role assignments. Roles themselves are a fixed system
 * vocabulary (admin/trainer) — there is intentionally no create/edit/delete of
 * roles, only assignment. All operations require the {@code admin} role; an admin
 * cannot strip their OWN admin role (another admin must).
 */
@Controller
class RoleAdminController {

    private final AppUserRepository userRepository;
    private final RoleRepository roleRepository;
    private final RoleService roleService;

    RoleAdminController(AppUserRepository userRepository, RoleRepository roleRepository, RoleService roleService) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.roleService = roleService;
    }

    @QueryMapping
    List<UserAccount> users(@Argument String search, @AuthenticationPrincipal Jwt jwt) {
        requireAdmin(jwt);
        List<AppUser> matched = (search == null || search.isBlank())
            ? userRepository.findAllByOrderByEmailAsc()
            : userRepository.search(search.trim());
        return matched.stream().map(u -> account(u.getId())).toList();
    }

    @QueryMapping
    List<RoleInfo> roles(@AuthenticationPrincipal Jwt jwt) {
        requireAdmin(jwt);
        return roleRepository.findAll().stream()
            .map(r -> new RoleInfo(r.getRoleKey(), r.getDescription()))
            .toList();
    }

    @MutationMapping
    UserAccount assignRole(@Argument String userId, @Argument String role, @AuthenticationPrincipal Jwt jwt) {
        requireAdmin(jwt);
        UUID id = UUID.fromString(userId);
        roleService.assign(id, role);
        return account(id);
    }

    @MutationMapping
    UserAccount removeRole(@Argument String userId, @Argument String role, @AuthenticationPrincipal Jwt jwt) {
        requireAdmin(jwt);
        if ("admin".equals(role) && jwt.getSubject().equals(userId)) {
            throw new IllegalStateException("You cannot remove your own admin role — ask another admin.");
        }
        UUID id = UUID.fromString(userId);
        roleService.revoke(id, role);
        return account(id);
    }

    private UserAccount account(UUID id) {
        AppUser u = userRepository.findById(id)
            .orElseThrow(() -> new IllegalArgumentException("Unknown user: " + id));
        return new UserAccount(u.getId().toString(), u.getEmail(), u.getName(),
            List.copyOf(roleService.rolesFor(id)));
    }

    /** Authorize on LIVE roles from the DB (the token's roles claim is only a UI hint). */
    private void requireAdmin(Jwt jwt) {
        if (jwt == null) {
            throw new AccessDeniedException("Authentication required");
        }
        if (!roleService.rolesFor(UUID.fromString(jwt.getSubject())).contains("admin")) {
            throw new AccessDeniedException("Admin role required");
        }
    }

    record UserAccount(String id, String email, String name, List<String> roles) {}

    record RoleInfo(String key, String description) {}
}
