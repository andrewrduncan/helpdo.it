-- Auth: app users + provider-neutral identity links. The app verifies an OIDC
-- login (any provider), upserts the user, and mints its OWN app JWT. Adding a
-- new provider never touches this schema — just a new login registration.

CREATE TABLE app_user (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL UNIQUE,
    name        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (provider, provider_key) — e.g. ('google', google-sub). A user can
-- have several links (sign in with Google or Microsoft → same account).
CREATE TABLE user_auth_link (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    provider     TEXT        NOT NULL,
    provider_key TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_key)
);
CREATE INDEX idx_user_auth_link_user ON user_auth_link (user_id);
