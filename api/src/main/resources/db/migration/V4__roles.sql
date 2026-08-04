-- Roles + claim-driven role assignment. Roles ride on the app JWT as a `roles`
-- claim; the rest of the app trusts only that token (provider-neutral). Tables
-- are prefixed (app_role) since `role` is a reserved word in Postgres.

CREATE TABLE app_role (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_key    TEXT        NOT NULL UNIQUE,   -- 'admin' | 'trainer' | 'user'
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The role vocabulary the app reasons about (not seed *content* — the fixed set
-- of roles). Grants are made separately, into user_role.
INSERT INTO app_role (role_key, description) VALUES
    ('admin',   'Full administrative access'),
    ('trainer', 'Can author/record knowledge (Train mode)'),
    ('user',    'Standard end user (FAQ only)');

-- Explicit user<->role grants (made manually, or applied from a claim mapping at
-- login). Surrogate id + unique pair so JPA stays simple.
CREATE TABLE user_role (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id    UUID        NOT NULL REFERENCES app_role(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role_id)
);
CREATE INDEX idx_user_role_user ON user_role (user_id);

-- Map an OIDC/JWT claim value to a role, e.g. ('email','you@corp.com')->trainer,
-- ('hd','corp.com')->trainer, or an Entra ('groups', <group-id>)->admin. Evaluated
-- on every login; a match grants the role idempotently. Seeded EMPTY by design —
-- for now grant trainer manually:
--   INSERT INTO user_role (user_id, role_id)
--   SELECT u.id, r.id FROM app_user u, app_role r
--   WHERE u.email = 'you@corp.com' AND r.role_key = 'trainer';
CREATE TABLE role_claim_mapping (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim       TEXT NOT NULL,        -- claim name as it appears in the provider's attributes
    claim_value TEXT NOT NULL,        -- value to match (scalar, or one of a collection like groups)
    role_id     UUID NOT NULL REFERENCES app_role(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (claim, claim_value, role_id)
);

-- The page a question was asked on — elevated from the page_context JSON so the
-- admin queue can filter by page and trainer answers can be scoped/attributed.
ALTER TABLE question ADD COLUMN page_url TEXT;
