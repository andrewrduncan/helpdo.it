package com.helpdoit.agent;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * An agent defined as data: persona, model, and the toolkits it may use.
 * Building block #2 — agents are rows, resolved via {@link AgentRegistry}.
 */
@Entity
@Table(name = "agent_definition")
@Getter
@Setter
public class AgentDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String slug;

    @Column(nullable = false)
    private String name;

    private String description;

    @Column(name = "system_prompt", nullable = false)
    private String systemPrompt;

    /** Provider model id; null means "use the application default". */
    private String model;

    /** Names of toolkits this agent may call (see {@code com.helpdoit.tool}). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private List<String> toolkits = new ArrayList<>();

    @Column(name = "max_tool_calls", nullable = false)
    private int maxToolCalls = 10;

    @Column(nullable = false)
    private boolean enabled = true;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
