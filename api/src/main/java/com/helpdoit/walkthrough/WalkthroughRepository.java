package com.helpdoit.walkthrough;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface WalkthroughRepository extends JpaRepository<Walkthrough, UUID> {

    /** The walkthrough that authored / backs a knowledge entry (for playback). */
    Optional<Walkthrough> findByKnowledgeEntryIdAndStatus(UUID knowledgeEntryId, String status);
}
