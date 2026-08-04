package com.helpdoit.question;

import java.util.List;
import java.util.UUID;

/**
 * Outcome of asking a question.
 *
 * <p>Three shapes: a single confident answer ({@code answer} set, one option);
 * several relevant options for the user to choose from ({@code answer} null,
 * {@code options} has 2+ — rendered as clickable bubbles); or nothing relevant
 * ({@code answered} false, {@code options} empty → queued for a human).
 *
 * @param questionId       the persisted question row
 * @param answered         true if at least one relevant entry was surfaced
 * @param answer           the answer text when a single match is returned inline (else null)
 * @param knowledgeEntryId the matched entry when answered inline (else null)
 * @param options          relevant entries to choose from (best first); 1 → also inline
 */
public record AskResult(UUID questionId, boolean answered, String answer, UUID knowledgeEntryId,
                        List<AnswerOption> options) {

    public AskResult {
        options = options == null ? List.of() : List.copyOf(options);
    }
}
