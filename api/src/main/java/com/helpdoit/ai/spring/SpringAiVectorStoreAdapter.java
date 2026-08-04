package com.helpdoit.ai.spring;

import com.helpdoit.ai.KnowledgeChunk;
import com.helpdoit.ai.RetrievedChunk;
import com.helpdoit.ai.VectorStorePort;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.FilterExpressionBuilder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * Spring AI implementation of {@link VectorStorePort}, backed by the configured
 * {@link VectorStore} (pgvector). Translates our framework-neutral DTOs to and
 * from Spring AI {@link Document}s.
 */
@Component
class SpringAiVectorStoreAdapter implements VectorStorePort {

    private final VectorStore vectorStore;

    SpringAiVectorStoreAdapter(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    @Override
    public void upsert(List<KnowledgeChunk> chunks) {
        List<Document> docs = chunks.stream()
            .map(c -> Document.builder()
                .id(c.id())
                .text(c.content())
                .metadata(c.metadata())
                .build())
            .toList();
        vectorStore.add(docs);   // add() upserts by id
    }

    @Override
    public void delete(List<String> ids) {
        if (ids != null && !ids.isEmpty()) {
            vectorStore.delete(ids);
        }
    }

    @Override
    public List<RetrievedChunk> search(String query, int topK, String domain) {
        SearchRequest.Builder builder = SearchRequest.builder().query(query).topK(topK);
        if (domain != null && !domain.isBlank()) {
            // Scope to one domain's vectors via a metadata-equality filter. The "domain"
            // key matches KnowledgeService.DOMAIN written at index time.
            builder.filterExpression(new FilterExpressionBuilder().eq("domain", domain).build());
        }
        SearchRequest request = builder.build();
        List<Document> results = Optional.ofNullable(vectorStore.similaritySearch(request)).orElse(List.of());
        return results.stream()
            .map(d -> new RetrievedChunk(
                d.getId(),
                d.getText(),
                d.getScore() == null ? 0.0 : d.getScore(),
                d.getMetadata()))
            .toList();
    }
}
