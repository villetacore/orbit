-- Self-service sign-up requests. Nothing is created in Keycloak until an
-- administrator approves a request; Orbit never stores passwords.
CREATE TABLE registrations (
    id          BIGSERIAL PRIMARY KEY,
    username    TEXT NOT NULL,
    email       TEXT NOT NULL,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    comment     TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    ip          TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at  TIMESTAMPTZ,
    decided_by  TEXT NOT NULL DEFAULT '',
    user_sub    TEXT NOT NULL DEFAULT ''
);

-- One open request per login and per address.
CREATE UNIQUE INDEX registrations_pending_username ON registrations (lower(username)) WHERE status = 'pending';
CREATE UNIQUE INDEX registrations_pending_email ON registrations (lower(email)) WHERE status = 'pending';
CREATE INDEX registrations_status_created ON registrations (status, created_at DESC);
