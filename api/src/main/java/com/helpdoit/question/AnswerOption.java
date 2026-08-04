package com.helpdoit.question;

/**
 * One candidate answer surfaced for a question — shown to the user as a clickable
 * option ("bubble") when several are relevant. The user picks one to see its full
 * answer (and, when {@code hasWalkthrough}, to play the recorded steps).
 *
 * @param knowledgeEntryId the entry this option resolves to
 * @param title            the entry's title (the phrasing shown on the bubble)
 * @param snippet          a short preview of the answer
 * @param hasWalkthrough   true if a recorded walkthrough backs this entry (→ playback)
 */
public record AnswerOption(String knowledgeEntryId, String title, String snippet, boolean hasWalkthrough) {}
