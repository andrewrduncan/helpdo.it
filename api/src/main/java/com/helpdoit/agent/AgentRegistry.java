package com.helpdoit.agent;

import com.helpdoit.graphql.error.NotFoundException;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Resolves agent definitions by slug. The single place the rest of the app
 * looks up "which agent" — today backed by the DB, but callers depend only on
 * this, so a cached or per-tenant source can drop in later.
 */
@Component
public class AgentRegistry {

    private final AgentDefinitionRepository repository;

    public AgentRegistry(AgentDefinitionRepository repository) {
        this.repository = repository;
    }

    public AgentDefinition require(String slug) {
        return repository.findBySlugAndEnabledTrue(slug)
            .orElseThrow(() -> new NotFoundException("Agent '" + slug + "'"));
    }

    public List<AgentDefinition> all() {
        return repository.findAll();
    }
}
