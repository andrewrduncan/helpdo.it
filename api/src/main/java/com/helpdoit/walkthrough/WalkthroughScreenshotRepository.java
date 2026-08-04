package com.helpdoit.walkthrough;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface WalkthroughScreenshotRepository extends JpaRepository<WalkthroughScreenshot, UUID> {
    List<WalkthroughScreenshot> findByWalkthroughIdOrderByStepIndexAsc(UUID walkthroughId);
    boolean existsByWalkthroughIdAndStepIndex(UUID walkthroughId, int stepIndex);
}
