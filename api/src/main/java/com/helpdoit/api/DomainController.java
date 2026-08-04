package com.helpdoit.api;

import com.helpdoit.domain.Domain;
import com.helpdoit.domain.DomainService;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Domain registry + per-user enablement for the extension. The registry list is
 * public (it's just hostnames); enabling/disabling is per signed-in user and keyed
 * on the JWT subject (the AppUser id). The extension renders only on enabled domains.
 */
@RestController
@RequestMapping("/api/domains")
class DomainController {

    private final DomainService domainService;

    DomainController(DomainService domainService) {
        this.domainService = domainService;
    }

    /** Registered active domains (host-ordered). */
    @GetMapping
    List<DomainView> list() {
        return domainService.list().stream()
            .map(d -> new DomainView(d.getId().toString(), d.getHost(), name(d)))
            .toList();
    }

    /** The signed-in user's enabled domain ids. */
    @GetMapping("/enabled")
    List<String> enabled(@AuthenticationPrincipal Jwt jwt) {
        return domainService.enabledFor(userId(jwt)).stream().map(UUID::toString).toList();
    }

    @PutMapping("/{id}/enabled")
    void enable(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        domainService.enable(userId(jwt), UUID.fromString(id));
    }

    @DeleteMapping("/{id}/enabled")
    void disable(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        domainService.disable(userId(jwt), UUID.fromString(id));
    }

    private static UUID userId(Jwt jwt) {
        if (jwt == null) {
            throw new AccessDeniedException("Authentication required");
        }
        return UUID.fromString(jwt.getSubject());
    }

    private static String name(Domain d) {
        return d.getName() == null || d.getName().isBlank() ? d.getHost() : d.getName();
    }

    record DomainView(String id, String host, String name) {}
}
