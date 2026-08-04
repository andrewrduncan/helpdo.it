package com.helpdoit.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.helpdoit.auth.RoleService;
import com.helpdoit.domain.Domain;
import com.helpdoit.domain.DomainService;
import com.helpdoit.knowledge.KnowledgeEntry;
import com.helpdoit.knowledge.KnowledgeEntryRepository;
import com.helpdoit.knowledge.KnowledgeService;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Controller;

import java.util.List;
import java.util.UUID;

/** GraphQL reads + management for the Knowledge admin page. */
@Controller
class KnowledgeQueryController {

    private final KnowledgeEntryRepository repository;
    private final KnowledgeService knowledgeService;
    private final RoleService roleService;
    private final DomainService domainService;

    KnowledgeQueryController(KnowledgeEntryRepository repository, KnowledgeService knowledgeService,
                             RoleService roleService, DomainService domainService) {
        this.repository = repository;
        this.knowledgeService = knowledgeService;
        this.roleService = roleService;
        this.domainService = domainService;
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** The registered domains (host-ordered) — populates the Knowledge page's domain select. */
    @QueryMapping
    List<Domain> domains() {
        return domainService.list();
    }

    /**
     * Knowledge entries for one domain. The admin must pick a domain first, so a null
     * {@code domainId} returns nothing rather than the whole (cross-domain) corpus.
     */
    @QueryMapping
    List<KnowledgeEntry> knowledgeEntries(@Argument String domainId) {
        if (domainId == null || domainId.isBlank()) {
            return List.of();
        }
        return repository.findByDomainIdOrderByUpdatedAtDesc(UUID.fromString(domainId));
    }

    /** The authoring page from the entry's metadata blob — where the Edit button opens. */
    @SchemaMapping(typeName = "KnowledgeEntry")
    String pageUrl(KnowledgeEntry entry) {
        try {
            String url = MAPPER.readTree(entry.getMetadata() == null ? "{}" : entry.getMetadata())
                .path(KnowledgeService.PAGE_URL).asText("");
            return url.isBlank() ? null : url;
        } catch (Exception e) {
            return null;
        }
    }

    @MutationMapping
    boolean deleteKnowledgeEntry(@Argument String id, @AuthenticationPrincipal Jwt jwt) {
        requireManager(jwt);
        knowledgeService.delete(UUID.fromString(id));
        return true;
    }

    /** Managing the corpus is the trainer's job (and admins can do anything). Live DB roles. */
    private void requireManager(Jwt jwt) {
        if (jwt == null) {
            throw new AccessDeniedException("Authentication required");
        }
        var roles = roleService.rolesFor(UUID.fromString(jwt.getSubject()));
        if (!roles.contains("admin") && !roles.contains("trainer")) {
            throw new AccessDeniedException("Trainer or admin role required");
        }
    }
}
