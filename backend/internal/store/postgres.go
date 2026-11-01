package store

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/villetacore/orbit/backend/internal/auth"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Migrate applies embedded migrations in lexical order, each in its own
// transaction, under an advisory lock so concurrent instances are safe.
func (p *Postgres) Migrate(ctx context.Context) error {
	conn, err := p.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	const lockID = 0x6f72626974 // "orbit"
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockID); err != nil {
		return err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockID) //nolint:errcheck

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		var exists bool
		if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		err = pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, name)
			return err
		})
		if err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
	}
	return nil
}

// --- sessions (auth.Repo) ---

func (p *Postgres) SaveSession(ctx context.Context, idHash, sub string, payload []byte, expiresAt time.Time) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO sessions (id_hash, sub, payload, expires_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (id_hash) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
		idHash, sub, payload, expiresAt)
	return err
}

func (p *Postgres) LoadSession(ctx context.Context, idHash string) ([]byte, error) {
	var payload []byte
	err := p.pool.QueryRow(ctx, `SELECT payload FROM sessions WHERE id_hash = $1 AND expires_at > now()`, idHash).Scan(&payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, auth.ErrNoSession
	}
	return payload, err
}

func (p *Postgres) DeleteSession(ctx context.Context, idHash string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM sessions WHERE id_hash = $1`, idHash)
	return err
}

func (p *Postgres) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	tag, err := p.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at <= now()`)
	return tag.RowsAffected(), err
}

// --- profiles & avatars ---

func (p *Postgres) TouchProfile(ctx context.Context, sub string) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO user_profiles (sub) VALUES ($1)
		ON CONFLICT (sub) DO UPDATE SET last_login_at = now()`, sub)
	return err
}

func (p *Postgres) GetAvatar(ctx context.Context, sub string) (*Avatar, error) {
	a := Avatar{Sub: sub}
	err := p.pool.QueryRow(ctx, `SELECT object_key, content_type, size_bytes, uploaded_at FROM avatars WHERE sub = $1`, sub).
		Scan(&a.ObjectKey, &a.ContentType, &a.SizeBytes, &a.UploadedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &a, err
}

func (p *Postgres) SetAvatar(ctx context.Context, a Avatar) (string, error) {
	var prev string
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO user_profiles (sub) VALUES ($1) ON CONFLICT DO NOTHING`, a.Sub); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `SELECT object_key FROM avatars WHERE sub = $1 FOR UPDATE`, a.Sub).Scan(&prev)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO avatars (sub, object_key, content_type, size_bytes, uploaded_at) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (sub) DO UPDATE SET object_key = EXCLUDED.object_key, content_type = EXCLUDED.content_type,
				size_bytes = EXCLUDED.size_bytes, uploaded_at = EXCLUDED.uploaded_at`,
			a.Sub, a.ObjectKey, a.ContentType, a.SizeBytes, a.UploadedAt)
		return err
	})
	return prev, err
}

func (p *Postgres) DeleteAvatar(ctx context.Context, sub string) (string, error) {
	var key string
	err := p.pool.QueryRow(ctx, `DELETE FROM avatars WHERE sub = $1 RETURNING object_key`, sub).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return key, err
}

// --- catalog ---

const serviceColumns = `id, slug, name, description, url, icon_url, category, status, required_roles, sort_order, created_at, updated_at`

func scanService(row pgx.Row) (*Service, error) {
	var s Service
	err := row.Scan(&s.ID, &s.Slug, &s.Name, &s.Description, &s.URL, &s.IconURL, &s.Category, &s.Status,
		&s.RequiredRoles, &s.SortOrder, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if s.RequiredRoles == nil {
		s.RequiredRoles = []string{}
	}
	return &s, err
}

func (p *Postgres) ListServices(ctx context.Context) ([]Service, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+serviceColumns+` FROM services ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Service
	for rows.Next() {
		s, err := scanService(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func (p *Postgres) GetService(ctx context.Context, id string) (*Service, error) {
	return scanService(p.pool.QueryRow(ctx, `SELECT `+serviceColumns+` FROM services WHERE id::text = $1`, id))
}

// pgx encodes a nil slice as NULL; the column is NOT NULL.
func nonNilRoles(roles []string) []string {
	if roles == nil {
		return []string{}
	}
	return roles
}

func (p *Postgres) CreateService(ctx context.Context, in ServiceInput) (*Service, error) {
	in.RequiredRoles = nonNilRoles(in.RequiredRoles)
	s, err := scanService(p.pool.QueryRow(ctx, `
		INSERT INTO services (slug, name, description, url, icon_url, category, status, required_roles, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING `+serviceColumns,
		in.Slug, in.Name, in.Description, in.URL, in.IconURL, in.Category, in.Status, in.RequiredRoles, in.SortOrder))
	return s, mapConflict(err)
}

func (p *Postgres) UpdateService(ctx context.Context, id string, in ServiceInput) (*Service, error) {
	in.RequiredRoles = nonNilRoles(in.RequiredRoles)
	s, err := scanService(p.pool.QueryRow(ctx, `
		UPDATE services SET slug = $2, name = $3, description = $4, url = $5, icon_url = $6, category = $7,
			status = $8, required_roles = $9, sort_order = $10, updated_at = now()
		WHERE id::text = $1 RETURNING `+serviceColumns,
		id, in.Slug, in.Name, in.Description, in.URL, in.IconURL, in.Category, in.Status, in.RequiredRoles, in.SortOrder))
	return s, mapConflict(err)
}

func (p *Postgres) DeleteService(ctx context.Context, id string) error {
	tag, err := p.pool.Exec(ctx, `DELETE FROM services WHERE id::text = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func mapConflict(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrConflict
	}
	return err
}

func (p *Postgres) Favorites(ctx context.Context, sub string) (map[string]bool, error) {
	rows, err := p.pool.Query(ctx, `SELECT service_id::text FROM user_service_preferences WHERE sub = $1 AND favorite`, sub)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

func (p *Postgres) SetFavorite(ctx context.Context, sub, serviceID string, favorite bool) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO user_service_preferences (sub, service_id, favorite) VALUES ($1, $2::uuid, $3)
		ON CONFLICT (sub, service_id) DO UPDATE SET favorite = EXCLUDED.favorite, updated_at = now()`,
		sub, serviceID, favorite)
	return err
}

// SeedDemoServices fills an empty catalog with example entries for local development.
func (p *Postgres) SeedDemoServices(ctx context.Context, keycloakURL, realm, adminRole string) error {
	var n int
	if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM services`).Scan(&n); err != nil || n > 0 {
		return err
	}
	for _, in := range DemoServices(keycloakURL, realm, adminRole) {
		if _, err := p.CreateService(ctx, in); err != nil {
			return err
		}
	}
	return nil
}

// --- audit ---

func (p *Postgres) RecordAudit(ctx context.Context, e AuditEvent) error {
	if e.Details == nil {
		e.Details = map[string]any{}
	}
	_, err := p.pool.Exec(ctx, `
		INSERT INTO audit_events (actor_sub, action, target, ip, user_agent, details) VALUES ($1, $2, $3, $4, $5, $6)`,
		e.ActorSub, e.Action, e.Target, e.IP, e.UserAgent, e.Details)
	return err
}

func (p *Postgres) ListAudit(ctx context.Context, limit int, beforeID int64) ([]AuditEvent, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, occurred_at, actor_sub, action, target, ip, user_agent, details FROM audit_events
		WHERE ($2 = 0 OR id < $2) ORDER BY id DESC LIMIT $1`, limit, beforeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEvent
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(&e.ID, &e.OccurredAt, &e.ActorSub, &e.Action, &e.Target, &e.IP, &e.UserAgent, &e.Details); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
