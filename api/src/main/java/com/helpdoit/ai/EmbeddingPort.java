package com.helpdoit.ai;

import java.util.List;

/**
 * Framework-agnostic embedding port — turns text into vectors for the RAG
 * pipeline. Implementations live in an adapter package; domain code never sees
 * the underlying framework or provider.
 */
public interface EmbeddingPort {

    /** Embed a single piece of text. */
    float[] embed(String text);

    /** Embed a batch of texts, preserving order. */
    List<float[]> embed(List<String> texts);

    /** Dimensionality of the vectors this model produces (must match the vector store). */
    int dimensions();
}
