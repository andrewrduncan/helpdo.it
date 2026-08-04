package com.helpdoit.tag;

import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/** Tags: type-ahead search, get-or-create, and attaching tags to knowledge entries. */
@Service
public class TagService {

    private final TagRepository tags;
    private final KnowledgeEntryTagRepository links;

    public TagService(TagRepository tags, KnowledgeEntryTagRepository links) {
        this.tags = tags;
        this.links = links;
    }

    /** Type-ahead suggestions (existing tag names) for the recommend box. */
    @Transactional(readOnly = true)
    public List<String> suggest(String query) {
        if (query == null || query.isBlank()) {
            return List.of();
        }
        return tags.findByNameContainingIgnoreCaseOrderByNameAsc(query.trim(), Limit.of(10))
            .stream().map(Tag::getName).toList();
    }

    /** Find an existing tag by name (case-insensitive) or create it. */
    @Transactional
    public Tag getOrCreate(String name) {
        String normalized = name.trim();
        return tags.findByNameIgnoreCase(normalized).orElseGet(() -> {
            Tag tag = new Tag();
            tag.setName(normalized);
            return tags.save(tag);
        });
    }

    /** The tag names attached to a knowledge entry (alphabetical). */
    @Transactional(readOnly = true)
    public List<String> tagsFor(UUID knowledgeEntryId) {
        List<UUID> tagIds = links.findByKnowledgeEntryId(knowledgeEntryId).stream()
            .map(KnowledgeEntryTag::getTagId).toList();
        if (tagIds.isEmpty()) {
            return List.of();
        }
        return tags.findAllById(tagIds).stream().map(Tag::getName).sorted().toList();
    }

    /** Replace a knowledge entry's tags with exactly this set (add + remove). */
    @Transactional
    public void setTags(UUID knowledgeEntryId, List<String> names) {
        links.deleteByKnowledgeEntryId(knowledgeEntryId);
        attach(knowledgeEntryId, names);
    }

    /** Attach a set of tag names (created as needed) to a knowledge entry, idempotently. */
    @Transactional
    public void attach(UUID knowledgeEntryId, List<String> names) {
        if (names == null) {
            return;
        }
        for (String name : names) {
            if (name == null || name.isBlank()) {
                continue;
            }
            UUID tagId = getOrCreate(name).getId();
            if (!links.existsByKnowledgeEntryIdAndTagId(knowledgeEntryId, tagId)) {
                KnowledgeEntryTag link = new KnowledgeEntryTag();
                link.setKnowledgeEntryId(knowledgeEntryId);
                link.setTagId(tagId);
                links.save(link);
            }
        }
    }
}
