package com.helpdoit.api;

import com.helpdoit.auth.RoleService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The signed-in user, read from the validated app JWT. Requires authentication
 * (see SecurityConfig) — proves the OIDC login → app-JWT → resource-server loop
 * end to end. Roles are resolved LIVE from the DB (not the token's claim) so a
 * role change takes effect on the next request, without re-login.
 */
@RestController
@RequestMapping("/api")
class MeController {

    private final RoleService roleService;

    MeController(RoleService roleService) {
        this.roleService = roleService;
    }

    @GetMapping("/me")
    Me me(@AuthenticationPrincipal Jwt jwt) {
        String picture = jwt.getClaimAsString("picture");
        return new Me(
            jwt.getSubject(),
            jwt.getClaimAsString("email"),
            jwt.getClaimAsString("name"),
            picture == null || picture.isBlank() ? null : picture,
            jwt.getClaimAsString("provider"),
            List.copyOf(roleService.rolesFor(UUID.fromString(jwt.getSubject()))));
    }

    record Me(String id, String email, String name, String picture, String provider, List<String> roles) {}
}
