package com.helpdoit.tag;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface KnowledgeEntryTagRepository extends JpaRepository<KnowledgeEntryTag, UUID> {
    List<KnowledgeEntryTag> findByKnowledgeEntryId(UUID knowledgeEntryId);
    boolean existsByKnowledgeEntryIdAndTagId(UUID knowledgeEntryId, UUID tagId);
    void deleteByKnowledgeEntryId(UUID knowledgeEntryId);
}
