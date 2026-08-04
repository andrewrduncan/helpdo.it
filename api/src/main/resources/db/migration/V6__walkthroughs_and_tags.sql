-- Recorded walkthroughs: an ordered, typed step sequence captured in Train mode
-- that answers a question and can be replayed to guide a user later. Steps live
-- as a JSON array (each {type: click|navigate|rightClick|..., ...}); screenshots
-- (one per step, optional) are stored separately so capture can be turned off.

CREATE TABLE walkthrough (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id        UUID REFERENCES question(id)        ON DELETE SET NULL,  -- question this answers (if from the queue)
    knowledge_entry_id UUID REFERENCES knowledge_entry(id) ON DELETE CASCADE,   -- set when finalized on Stop
    status             TEXT    NOT NULL DEFAULT 'recording', -- recording | ready
    steps              JSONB   NOT NULL DEFAULT '[]',        -- ordered typed steps
    capture_screens    BOOLEAN NOT NULL DEFAULT true,
    created_by         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_walkthrough_question ON walkthrough (question_id);

-- One screenshot per step (none when capture is off). Kept out of the steps JSON
-- so the step list stays light and images are easy to omit/purge.
CREATE TABLE walkthrough_screenshot (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    walkthrough_id UUID NOT NULL REFERENCES walkthrough(id) ON DELETE CASCADE,
    step_index     INT  NOT NULL,
    image          TEXT NOT NULL,                       -- base64 (data URL payload)
    content_type   TEXT NOT NULL DEFAULT 'image/jpeg',
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (walkthrough_id, step_index)
);

-- Tags: a shared vocabulary for knowledge entries, with type-ahead recommend.
CREATE TABLE tag (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE knowledge_entry_tag (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_entry_id UUID NOT NULL REFERENCES knowledge_entry(id) ON DELETE CASCADE,
    tag_id             UUID NOT NULL REFERENCES tag(id)             ON DELETE CASCADE,
    UNIQUE (knowledge_entry_id, tag_id)
);
CREATE INDEX idx_knowledge_entry_tag_entry ON knowledge_entry_tag (knowledge_entry_id);
