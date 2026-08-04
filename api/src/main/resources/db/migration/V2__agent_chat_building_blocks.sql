-- Agent/chat building blocks, distilled from promptlydo.it into normalized,
-- reusable pieces on top of the AI ports. (Attachments land in a later migration.)

-- -----------------------------------------------------------------------------
-- agent_definition — agents are DATA, not classes. A row defines an agent's
-- persona, model, and which toolkits it may use. Resolved via AgentRegistry.
-- -----------------------------------------------------------------------------
CREATE TABLE agent_definition (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           TEXT        NOT NULL UNIQUE,
    name           TEXT        NOT NULL,
    description    TEXT,
    system_prompt  TEXT        NOT NULL,
    model          TEXT,                               -- null = use the app default model
    toolkits       JSONB       NOT NULL DEFAULT '[]',  -- array of toolkit names this agent may call
    max_tool_calls INT         NOT NULL DEFAULT 10,    -- per-turn cap (governance; enforced later)
    enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- conversation + message — persistent multi-turn chat. tool_calls keeps the
-- replayable tool context for an assistant turn (promptlydo's ReplayToolCalls).
-- -----------------------------------------------------------------------------
CREATE TABLE conversation (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_slug  TEXT,                                   -- which agent drives this conversation
    title       TEXT,
    status      TEXT        NOT NULL DEFAULT 'active',  -- active | archived
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE message (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  UUID        NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    role             TEXT        NOT NULL,              -- USER | ASSISTANT | SYSTEM
    content          TEXT        NOT NULL,
    tool_calls       JSONB,                             -- replayed tool context, if any
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_message_conversation ON message (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- agent_task — broker-free async queue. A scheduled loop claims due rows with a
-- locked_until lease (FOR UPDATE SKIP LOCKED). Concrete task types implement
-- the AgentTask handler interface; defined later.
-- -----------------------------------------------------------------------------
CREATE TABLE agent_task (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type          TEXT        NOT NULL,                 -- dispatch key → AgentTask handler
    payload       JSONB,
    status        TEXT        NOT NULL DEFAULT 'PENDING', -- PENDING | RUNNING | DONE | FAILED
    attempts      INT         NOT NULL DEFAULT 0,
    locked_until  TIMESTAMPTZ,
    result        JSONB,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_claim ON agent_task (status, locked_until);

-- Seed one agent so the registry has something to resolve out of the box.
INSERT INTO agent_definition (slug, name, description, system_prompt, toolkits)
VALUES (
    'helper',
    'Help Assistant',
    'Default in-app help agent for helpdo.it.',
    'You are helpdo.it''s in-app help assistant. Answer concisely and, when you can, give concrete step-by-step guidance for the app the user is in. If you are unsure, say so.',
    '["clock"]'
);
