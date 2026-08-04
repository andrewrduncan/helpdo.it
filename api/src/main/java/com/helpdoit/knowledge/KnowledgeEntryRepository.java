package com.helpdoit.knowledge;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface KnowledgeEntryRepository extends JpaRepository<KnowledgeEntry, UUID> {
    List<KnowledgeEntry> findAllByOrderByUpdatedAtDesc();

    List<KnowledgeEntry> findByDomainIdOrderByUpdatedAtDesc(UUID domainId);
}
