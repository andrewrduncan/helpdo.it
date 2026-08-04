package com.helpdoit.ai;

import java.util.List;

/**
 * Framework-agnostic vector store port — the RAG knowledge index.
 *
 * <p>Embedding is handled by the implementation (it owns an {@link EmbeddingPort}
 * or the framework's equivalent), so callers pass plain text in and get ranked
 * text out. Domain code never touches Spring AI's {@code Document}/{@code VectorStore}.
 */
public interface VectorStorePort {

    /** Insert or replace knowledge chunks (the implementation embeds them). */
    void upsert(List<KnowledgeChunk> chunks);

    /** Remove chunks by id (so deleted knowledge stops being retrieved). */
    void delete(List<String> ids);

    /** Semantic search: embed {@code query} and return the {@code topK} closest chunks. */
    default List<RetrievedChunk> search(String query, int topK) {
        return search(query, topK, null);
    }

    /**
     * Semantic search scoped to a domain: same as {@link #search(String, int)} but only
     * over chunks whose {@code domain} metadata equals {@code domain}. A null/blank
     * {@code domain} means no scoping (search everything).
     */
    List<RetrievedChunk> search(String query, int topK, String domain);
}
