// Package store holds Orbit's own data: catalog, preferences, avatar metadata,
// sessions and the audit log. Users are linked to Keycloak by the immutable
// OIDC subject (sub), never by email.
package store

import (
	"context"
	"errors"
	"time"
)

var (
	ErrNotFound = errors.New("store: not found")
	ErrConflict = errors.New("store: conflict")
)

type ServiceStatus string

const (
	StatusActive      ServiceStatus = "active"
	StatusMaintenance ServiceStatus = "maintenance"
	StatusHidden      ServiceStatus = "hidden"
)

type Service struct {
	ID            string        `json:"id"`
	Slug          string        `json:"slug"`
	Name          string        `json:"name"`
	Description   string        `json:"description"`
	URL           string        `json:"url"`
	IconURL       string        `json:"iconUrl"`
	Category      string        `json:"category"`
	Status        ServiceStatus `json:"status"`
	RequiredRoles []string      `json:"requiredRoles"`
	SortOrder     int           `json:"sortOrder"`
	CreatedAt     time.Time     `json:"createdAt"`
	UpdatedAt     time.Time     `json:"updatedAt"`
}

type ServiceInput struct {
	Slug          string        `json:"slug"`
	Name          string        `json:"name"`
	Description   string        `json:"description"`
	URL           string        `json:"url"`
	IconURL       string        `json:"iconUrl"`
	Category      string        `json:"category"`
	Status        ServiceStatus `json:"status"`
	RequiredRoles []string      `json:"requiredRoles"`
	SortOrder     int           `json:"sortOrder"`
}

type Avatar struct {
	Sub         string
	ObjectKey   string
	ContentType string
	SizeBytes   int
	UploadedAt  time.Time
}

type AuditEvent struct {
	ID         int64          `json:"id"`
	OccurredAt time.Time      `json:"occurredAt"`
	ActorSub   string         `json:"actorSub"`
	Action     string         `json:"action"`
	Target     string         `json:"target"`
	IP         string         `json:"ip"`
	UserAgent  string         `json:"userAgent"`
	Details    map[string]any `json:"details"`
}

// Store is the persistence contract used by the HTTP API.
type Store interface {
	TouchProfile(ctx context.Context, sub string) error

	GetAvatar(ctx context.Context, sub string) (*Avatar, error)
	// SetAvatar upserts the avatar and returns the previous object key, if any.
	SetAvatar(ctx context.Context, a Avatar) (string, error)
	// DeleteAvatar removes the avatar and returns its object key.
	DeleteAvatar(ctx context.Context, sub string) (string, error)

	ListServices(ctx context.Context) ([]Service, error)
	GetService(ctx context.Context, id string) (*Service, error)
	CreateService(ctx context.Context, in ServiceInput) (*Service, error)
	UpdateService(ctx context.Context, id string, in ServiceInput) (*Service, error)
	DeleteService(ctx context.Context, id string) error

	Favorites(ctx context.Context, sub string) (map[string]bool, error)
	SetFavorite(ctx context.Context, sub, serviceID string, favorite bool) error

	// GetBranding returns the saved branding, or DefaultBranding if none.
	GetBranding(ctx context.Context) (Branding, error)
	SaveBranding(ctx context.Context, b Branding, actor string) error

	RecordAudit(ctx context.Context, e AuditEvent) error
	ListAudit(ctx context.Context, limit int, beforeID int64) ([]AuditEvent, error)
}
