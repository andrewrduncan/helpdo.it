package com.helpdoit.question;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.helpdoit.ai.AiModels;
import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.ChatPrompt;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * The escalation step of AI-assisted search: when the first vector query surfaces
 * nothing relevant, rewrite the question a few different ways so a re-search can
 * reach entries the original phrasing missed (synonyms, more/less specific, the
 * underlying task). Best-effort — returns empty on failure (caller just queues).
 */
@Service
public class QueryReformulator {

    private static final Logger log = LoggerFactory.getLogger(QueryReformulator.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ChatModelPort chat;
    private final AiModels models;

    public QueryReformulator(ChatModelPort chat, AiModels models) {
        this.chat = chat;
        this.models = models;
    }

    /** Up to {@code max} alternative search queries for the question (excludes the original). */
    public List<String> reformulate(String question, int max) {
        if (question == null || question.isBlank()) {
            return List.of();
        }
        try {
            String raw = chat.complete(new ChatPrompt(
                "Return ONLY a JSON array of strings, no markdown fences.",
                "A user's help question found no matches: \"" + question.trim() + "\". Rewrite it "
                    + max + " different ways to retry a knowledge-base search — vary synonyms, "
                    + "try the underlying task, and both more and less specific phrasings. "
                    + "Keep each short; do not repeat the original verbatim."), models.fast());
            JsonNode arr = MAPPER.readTree(stripFences(raw));
            List<String> out = new ArrayList<>();
            if (arr.isArray()) {
                for (JsonNode n : arr) {
                    String v = n.asText("").trim();
                    if (!v.isBlank() && out.size() < max) {
                        out.add(v);
                    }
                }
            }
            return out;
        } catch (Exception e) {
            log.warn("Query reformulation failed; no escalation queries", e);
            return List.of();
        }
    }

    private static String stripFences(String s) {
        if (s == null) {
            return "[]";
        }
        String t = s.trim();
        int open = t.indexOf('[');
        int close = t.lastIndexOf(']');
        return (open >= 0 && close > open) ? t.substring(open, close + 1) : t;
    }
}
