-- Domains: knowledge is partitioned by domain, where a domain IS the page's
-- hostname (e.g. app.example.com). Domains are registered
-- implicitly — the first knowledge entry trained on a host creates its domain.
-- Search is scoped to the page's domain so one site's answers never leak into
-- another's. Users opt in per domain (user_domain) and the extension renders
-- only on hosts the signed-in user has enabled.

CREATE TABLE domain (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host        TEXT NOT NULL UNIQUE,            -- the hostname, e.g. app.example.com
    name        TEXT,                            -- optional display label (defaults to host in the UI)
    status      TEXT NOT NULL DEFAULT 'active',  -- active | retired
    created_by  TEXT,                            -- author identity of the first entry that registered it
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE knowledge_entry ADD COLUMN domain_id UUID REFERENCES domain(id);
CREATE INDEX idx_knowledge_entry_domain ON knowledge_entry (domain_id);

-- Recorded at ask-time (derived from the page host) for future queue scoping.
ALTER TABLE question ADD COLUMN domain_id UUID REFERENCES domain(id);
CREATE INDEX idx_question_domain ON question (domain_id);

-- Per-user enablement (server-side). user_id is the AppUser UUID (the JWT subject).
CREATE TABLE user_domain (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    domain_id  UUID NOT NULL REFERENCES domain(id)    ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, domain_id)
);
CREATE INDEX idx_user_domain_user ON user_domain (user_id);
