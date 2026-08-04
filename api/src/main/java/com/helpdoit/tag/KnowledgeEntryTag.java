package com.helpdoit.tag;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/** Join of a knowledge entry to a {@link Tag}. */
@Entity
@Table(name = "knowledge_entry_tag")
@Getter
@Setter
public class KnowledgeEntryTag {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "knowledge_entry_id", nullable = false)
    private UUID knowledgeEntryId;

    @Column(name = "tag_id", nullable = false)
    private UUID tagId;
}
