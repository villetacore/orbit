CREATE TABLE sessions (
    id_hash    TEXT PRIMARY KEY,
    sub        TEXT NOT NULL,
    payload    BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_sub_idx ON sessions (sub);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE user_profiles (
    sub           TEXT PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE avatars (
    sub          TEXT PRIMARY KEY REFERENCES user_profiles (sub) ON DELETE CASCADE,
    object_key   TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE services (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    url            TEXT NOT NULL,
    icon_url       TEXT NOT NULL DEFAULT '',
    category       TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'hidden')),
    required_roles TEXT[] NOT NULL DEFAULT '{}',
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_service_preferences (
    sub        TEXT NOT NULL,
    service_id UUID NOT NULL REFERENCES services (id) ON DELETE CASCADE,
    favorite   BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sub, service_id)
);

CREATE TABLE audit_events (
    id          BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_sub   TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL,
    target      TEXT NOT NULL DEFAULT '',
    ip          TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT '',
    details     JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_sub, id DESC);
