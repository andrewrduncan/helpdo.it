package com.helpdoit.ai;

import java.util.Map;

/**
 * A knowledge chunk returned from a semantic search, with its similarity score.
 * The escalate-to-admin decision in the RAG flow keys off {@code score}.
 *
 * @param score similarity in [0,1] — higher is closer (provider/metric dependent)
 */
public record RetrievedChunk(String id, String content, double score, Map<String, Object> metadata) {}
