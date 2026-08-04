package com.helpdoit.ai.spring;

import com.helpdoit.ai.EmbeddingPort;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.stereotype.Component;

import java.util.List;

/** Spring AI implementation of {@link EmbeddingPort}. */
@Component
class SpringAiEmbeddingAdapter implements EmbeddingPort {

    private final EmbeddingModel embeddingModel;

    SpringAiEmbeddingAdapter(EmbeddingModel embeddingModel) {
        this.embeddingModel = embeddingModel;
    }

    @Override
    public float[] embed(String text) {
        return embeddingModel.embed(text);
    }

    @Override
    public List<float[]> embed(List<String> texts) {
        return embeddingModel.embed(texts);
    }

    @Override
    public int dimensions() {
        return embeddingModel.dimensions();
    }
}
