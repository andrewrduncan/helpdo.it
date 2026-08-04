package com.helpdoit.ai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Task-tier model selection. Rather than running every AI task on one model, callers
 * pick a tier suited to the task:
 * <ul>
 *   <li>{@link #fast()} — latency-critical, lightweight reasoning on the ask path
 *       (relevance grading, query reformulation, index-expansion). Favor a fast model.</li>
 *   <li>{@link #smart()} — heavier, quality-sensitive work that isn't on the ask path
 *       (walkthrough summarization + vision). Favor a stronger model.</li>
 * </ul>
 * A blank value means "use the provider's configured default model" ({@code null} override).
 * Tune via {@code HELPDOIT_FAST_MODEL} / {@code HELPDOIT_SMART_MODEL}.
 */
@Component
public class AiModels {

    private final String fast;
    private final String smart;

    public AiModels(@Value("${helpdoit.ai.model.fast:}") String fast,
                    @Value("${helpdoit.ai.model.smart:}") String smart) {
        this.fast = blankToNull(fast);
        this.smart = blankToNull(smart);
    }

    /** Fast model for the latency-critical ask path (grading, reformulation, expansion). */
    public String fast() {
        return fast;
    }

    /** Stronger model for off-path quality work (summarization, vision). */
    public String smart() {
        return smart;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
