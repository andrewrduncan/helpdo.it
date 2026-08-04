-- helpdo.it — initial baseline schema
-- Owned by Flyway; applied on the API's first boot (see application.yml).
--
-- This is the scaffold baseline for the RAG help domain described in the
-- README. Embedding/vector columns are intentionally NOT added yet — they land
-- when the AI framework + vector store are wired in (likely pgvector on this
-- same Postgres). Until then these tables hold the relational side: the
-- knowledge corpus, the admin question queue, and the feedback queue.

-- gen_random_uuid() lives in pgcrypto on older Postgres; it's in core on PG13+,
-- but enable the extension defensively so this runs on any 13+ image.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- knowledge_entry — trained domain knowledge + admin-authored answers.
-- The corpus the RAG pipeline retrieves from. Gets a vector column later.
-- -----------------------------------------------------------------------------
CREATE TABLE knowledge_entry (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT        NOT NULL,
    content     TEXT        NOT NULL,
    source      TEXT,                                   -- where it came from: 'training' | 'admin-answer' | ...
    status      TEXT        NOT NULL DEFAULT 'active',  -- active | retired
    metadata    JSONB,                                  -- tags, app/page scoping, etc.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- question — a user question raised from the extension, with captured context.
-- 'answered' when RAG was confident; 'queued' when escalated to an admin.
-- -----------------------------------------------------------------------------
CREATE TABLE question (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    text                TEXT        NOT NULL,
    page_context        JSONB,                                 -- URL, DOM/page state captured by the extension
    screen_capture_ref  TEXT,                                  -- pointer to stored screenshot/session, if any
    status              TEXT        NOT NULL DEFAULT 'queued', -- queued | answered | resolved
    answered_by_entry   UUID        REFERENCES knowledge_entry(id) ON DELETE SET NULL,
    asked_by            TEXT,                                  -- user identity, if known
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- feedback — a user flagging an answer as wrong/unhelpful. Queued for admins.
-- -----------------------------------------------------------------------------
CREATE TABLE feedback (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id     UUID        REFERENCES question(id)        ON DELETE SET NULL,
    knowledge_entry UUID        REFERENCES knowledge_entry(id) ON DELETE SET NULL,
    rating          TEXT,                                  -- 'helpful' | 'not_helpful' | 'wrong'
    comment         TEXT,
    status          TEXT        NOT NULL DEFAULT 'open',   -- open | reviewed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Queue / lookup indexes the admin UI will lean on.
CREATE INDEX idx_question_status        ON question (status);
CREATE INDEX idx_feedback_status        ON feedback (status);
CREATE INDEX idx_knowledge_entry_status ON knowledge_entry (status);
