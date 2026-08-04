package com.helpdoit.domain;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Domains keyed by page hostname. Registration is implicit: the first knowledge
 * entry trained on a host calls {@link #register} to create its domain. Search is
 * scoped by host, and users opt in per domain ({@code user_domain}).
 */
@Service
public class DomainService {

    private static final Logger log = LoggerFactory.getLogger(DomainService.class);

    private final DomainRepository domains;
    private final UserDomainRepository userDomains;

    public DomainService(DomainRepository domains, UserDomainRepository userDomains) {
        this.domains = domains;
        this.userDomains = userDomains;
    }

    /**
     * The hostname for a page URL — the domain key — lowercased and without port.
     * Returns null for blank/unparseable input. Mirrors the extension's {@code hostOf}.
     */
    public static String hostOf(String pageUrl) {
        if (pageUrl == null || pageUrl.isBlank()) {
            return null;
        }
        try {
            String host = URI.create(pageUrl.trim()).getHost();
            return host == null || host.isBlank() ? null : host.toLowerCase();
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Upsert and return the domain for a host (idempotent). No-op return for a blank host. */
    @Transactional
    public Domain register(String host, String createdBy) {
        if (host == null || host.isBlank()) {
            return null;
        }
        String key = host.toLowerCase();
        return domains.findByHost(key).orElseGet(() -> {
            Domain d = new Domain();
            d.setHost(key);
            d.setName(key);
            d.setCreatedBy(createdBy);
            Domain saved = domains.save(d);
            log.info("Registered domain {} ({})", key, saved.getId());
            return saved;
        });
    }

    @Transactional(readOnly = true)
    public Optional<Domain> resolveByHost(String host) {
        return host == null || host.isBlank() ? Optional.empty() : domains.findByHost(host.toLowerCase());
    }

    /** Active domains, host-ordered — the registry the extension and admin select read. */
    @Transactional(readOnly = true)
    public List<Domain> list() {
        return domains.findByStatusOrderByHostAsc("active");
    }

    @Transactional(readOnly = true)
    public List<UUID> enabledFor(UUID userId) {
        return userDomains.findByUserId(userId).stream().map(UserDomain::getDomainId).toList();
    }

    @Transactional
    public void enable(UUID userId, UUID domainId) {
        if (userDomains.existsByUserIdAndDomainId(userId, domainId)) {
            return;
        }
        UserDomain link = new UserDomain();
        link.setUserId(userId);
        link.setDomainId(domainId);
        userDomains.save(link);
    }

    @Transactional
    public void disable(UUID userId, UUID domainId) {
        userDomains.deleteByUserIdAndDomainId(userId, domainId);
    }
}
