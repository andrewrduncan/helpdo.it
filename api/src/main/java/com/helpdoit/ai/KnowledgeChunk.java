package com.helpdoit.ai;

import java.util.Map;

/**
 * A unit of knowledge to index in the vector store: stable id, the text to
 * embed, and arbitrary metadata (source, app/page scope, tags, ...).
 */
public record KnowledgeChunk(String id, String content, Map<String, Object> metadata) {

    public KnowledgeChunk(String id, String content) {
        this(id, content, Map.of());
    }
}
