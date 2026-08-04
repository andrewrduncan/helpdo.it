package com.helpdoit.question;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.helpdoit.ai.AiModels;
import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.ChatPrompt;
import com.helpdoit.ai.RetrievedChunk;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * AI-assisted relevance gate for retrieval. Vector search casts a wide net (recall);
 * this asks the chat model whether any candidate <em>actually answers</em> the
 * question and which one — the precision step. It's robust to typos and paraphrases
 * that a fixed similarity threshold would wrongly reject, while staying strict enough
 * to avoid answering with a merely keyword-similar entry.
 */
@Service
public class RetrievalGrader {

    private static final Logger log = LoggerFactory.getLogger(RetrievalGrader.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String SYSTEM = """
        You are the relevance gate for an in-app help system. Given a user's question
        and a numbered list of candidate knowledge entries (each a title + answer),
        return the entries that genuinely answer the question, best first.

        Be strict about intent: an entry must address what the user is trying to do —
        not merely share keywords. Tolerate typos and paraphrasing. BUT when several
        entries each offer a valid path to the goal (e.g. two different ways to start an
        order), return ALL of them, best first, so the user can choose — don't collapse
        to a single "best". Return ONLY entries that genuinely help; if none do, return
        an empty list.

        Respond with ONLY a JSON object, no markdown fences:
        {"indices": [<0-based indices of relevant entries, most relevant first>]}
        """;

    private final ChatModelPort chat;
    private final AiModels models;

    public RetrievalGrader(ChatModelPort chat, AiModels models) {
        this.chat = chat;
        this.models = models;
    }

    /**
     * The candidate indices that genuinely answer the question, ranked best-first
     * (empty if none). Best-effort: on any AI/parse failure returns empty (caller
     * escalates or queues).
     */
    public List<Integer> selectRelevant(String question, List<RetrievedChunk> candidates) {
        if (candidates.isEmpty()) {
            return List.of();
        }
        StringBuilder user = new StringBuilder("Question: \"")
            .append(question == null ? "" : question.trim()).append("\"\n\nCandidates:\n");
        for (int i = 0; i < candidates.size(); i++) {
            user.append('[').append(i).append("] ").append(oneLine(candidates.get(i).content())).append('\n');
        }

        try {
            String raw = chat.complete(new ChatPrompt(SYSTEM, user.toString()), models.fast());
            JsonNode root = MAPPER.readTree(stripFences(raw));
            JsonNode arr = root.path("indices");
            Set<Integer> ordered = new LinkedHashSet<>(); // de-dupe, preserve rank order
            if (arr.isArray()) {
                for (JsonNode n : arr) {
                    int idx = n.asInt(-1);
                    if (idx >= 0 && idx < candidates.size()) {
                        ordered.add(idx);
                    }
                }
            }
            return new ArrayList<>(ordered);
        } catch (Exception e) {
            log.warn("Retrieval grading failed; treating as no match", e);
            return List.of();
        }
    }

    private static String oneLine(String s) {
        if (s == null) {
            return "";
        }
        String collapsed = s.replaceAll("\\s+", " ").trim();
        return collapsed.length() > 600 ? collapsed.substring(0, 600) + "…" : collapsed;
    }

    private static String stripFences(String s) {
        if (s == null) {
            return "{}";
        }
        String t = s.trim();
        int open = t.indexOf('{');
        int close = t.lastIndexOf('}');
        return (open >= 0 && close > open) ? t.substring(open, close + 1) : t;
    }
}
