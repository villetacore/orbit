package store

import (
	"context"
	"time"
)

type RegistrationStatus string

const (
	RegistrationPending  RegistrationStatus = "pending"
	RegistrationApproved RegistrationStatus = "approved"
	RegistrationRejected RegistrationStatus = "rejected"
)

// Registration is a sign-up request waiting for an administrator.
type Registration struct {
	ID        int64              `json:"id"`
	Username  string             `json:"username"`
	Email     string             `json:"email"`
	FirstName string             `json:"firstName"`
	LastName  string             `json:"lastName"`
	Comment   string             `json:"comment"`
	Status    RegistrationStatus `json:"status"`
	IP        string             `json:"ip"`
	CreatedAt time.Time          `json:"createdAt"`
	DecidedAt *time.Time         `json:"decidedAt"`
	DecidedBy string             `json:"decidedBy"`
	UserSub   string             `json:"userSub"`
}

// Registrations is kept apart from Store so the catalog contract stays small.
type Registrations interface {
	// CreateRegistration returns ErrConflict when a pending request already
	// uses the same username or email.
	CreateRegistration(ctx context.Context, r Registration) (*Registration, error)
	// ListRegistrations returns requests with the status ("" for all), newest first.
	ListRegistrations(ctx context.Context, status RegistrationStatus, limit int) ([]Registration, error)
	GetRegistration(ctx context.Context, id int64) (*Registration, error)
	CountPendingRegistrations(ctx context.Context) (int, error)
	// DecideRegistration closes a pending request; ErrConflict if it is no
	// longer pending (another administrator was faster).
	DecideRegistration(ctx context.Context, id int64, status RegistrationStatus, actor, userSub string) error
}
