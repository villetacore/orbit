package store

import (
	"context"
	"crypto/rand"
	"fmt"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

// Memory is an in-process Store used by tests.
type Memory struct {
	mu        sync.Mutex
	profiles  map[string]bool
	avatars   map[string]Avatar
	services  map[string]Service
	favorites map[string]map[string]bool
	audit     []AuditEvent
	branding  *Branding
	regs      []Registration
}

func NewMemory() *Memory {
	return &Memory{
		profiles:  map[string]bool{},
		avatars:   map[string]Avatar{},
		services:  map[string]Service{},
		favorites: map[string]map[string]bool{},
	}
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func (m *Memory) TouchProfile(_ context.Context, sub string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.profiles[sub] = true
	return nil
}

func (m *Memory) GetAvatar(_ context.Context, sub string) (*Avatar, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.avatars[sub]
	if !ok {
		return nil, ErrNotFound
	}
	return &a, nil
}

func (m *Memory) SetAvatar(_ context.Context, a Avatar) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	prev := m.avatars[a.Sub].ObjectKey
	m.avatars[a.Sub] = a
	return prev, nil
}

func (m *Memory) DeleteAvatar(_ context.Context, sub string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.avatars[sub]
	if !ok {
		return "", ErrNotFound
	}
	delete(m.avatars, sub)
	return a.ObjectKey, nil
}

func (m *Memory) ListServices(_ context.Context) ([]Service, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Service, 0, len(m.services))
	for _, s := range m.services {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].SortOrder != out[j].SortOrder {
			return out[i].SortOrder < out[j].SortOrder
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func (m *Memory) GetService(_ context.Context, id string) (*Service, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.services[id]
	if !ok {
		return nil, ErrNotFound
	}
	return &s, nil
}

func (m *Memory) slugTaken(slug, exceptID string) bool {
	for id, s := range m.services {
		if s.Slug == slug && id != exceptID {
			return true
		}
	}
	return false
}

func (m *Memory) CreateService(_ context.Context, in ServiceInput) (*Service, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.slugTaken(in.Slug, "") {
		return nil, ErrConflict
	}
	now := time.Now()
	s := fromInput(newID(), in, now, now)
	m.services[s.ID] = s
	return &s, nil
}

func (m *Memory) UpdateService(_ context.Context, id string, in ServiceInput) (*Service, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old, ok := m.services[id]
	if !ok {
		return nil, ErrNotFound
	}
	if m.slugTaken(in.Slug, id) {
		return nil, ErrConflict
	}
	s := fromInput(id, in, old.CreatedAt, time.Now())
	m.services[id] = s
	return &s, nil
}

func fromInput(id string, in ServiceInput, created, updated time.Time) Service {
	return Service{
		ID: id, Slug: in.Slug, Name: in.Name, Description: in.Description, URL: in.URL, IconURL: in.IconURL,
		Category: in.Category, Status: in.Status, RequiredRoles: slices.Clone(in.RequiredRoles),
		SortOrder: in.SortOrder, CreatedAt: created, UpdatedAt: updated,
	}
}

func (m *Memory) DeleteService(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.services[id]; !ok {
		return ErrNotFound
	}
	delete(m.services, id)
	for _, favs := range m.favorites {
		delete(favs, id)
	}
	return nil
}

func (m *Memory) Favorites(_ context.Context, sub string) (map[string]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]bool{}
	for id, f := range m.favorites[sub] {
		if f {
			out[id] = true
		}
	}
	return out, nil
}

func (m *Memory) SetFavorite(_ context.Context, sub, serviceID string, favorite bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.favorites[sub] == nil {
		m.favorites[sub] = map[string]bool{}
	}
	m.favorites[sub][serviceID] = favorite
	return nil
}

func (m *Memory) GetBranding(context.Context) (Branding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.branding == nil {
		return DefaultBranding(), nil
	}
	return *m.branding, nil
}

func (m *Memory) SaveBranding(_ context.Context, b Branding, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.branding = &b
	return nil
}

func (m *Memory) RecordAudit(_ context.Context, e AuditEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e.ID = int64(len(m.audit) + 1)
	e.OccurredAt = time.Now()
	m.audit = append(m.audit, e)
	return nil
}

func (m *Memory) ListAudit(_ context.Context, limit int, beforeID int64) ([]AuditEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []AuditEvent
	for i := len(m.audit) - 1; i >= 0 && len(out) < limit; i-- {
		if beforeID == 0 || m.audit[i].ID < beforeID {
			out = append(out, m.audit[i])
		}
	}
	return out, nil
}

// AuditActions returns recorded action names in order; handy in tests.
func (m *Memory) AuditActions() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.audit))
	for i, e := range m.audit {
		out[i] = e.Action
	}
	return out
}

func (m *Memory) CreateRegistration(_ context.Context, r Registration) (*Registration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, x := range m.regs {
		if x.Status == RegistrationPending && (strings.EqualFold(x.Username, r.Username) || strings.EqualFold(x.Email, r.Email)) {
			return nil, ErrConflict
		}
	}
	r.ID = int64(len(m.regs) + 1)
	r.Status = RegistrationPending
	r.CreatedAt = time.Now().UTC()
	m.regs = append(m.regs, r)
	return &r, nil
}

func (m *Memory) ListRegistrations(_ context.Context, status RegistrationStatus, limit int) ([]Registration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Registration{}
	for i := len(m.regs) - 1; i >= 0 && len(out) < limit; i-- {
		if status == "" || m.regs[i].Status == status {
			out = append(out, m.regs[i])
		}
	}
	return out, nil
}

func (m *Memory) GetRegistration(_ context.Context, id int64) (*Registration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id < 1 || id > int64(len(m.regs)) {
		return nil, ErrNotFound
	}
	r := m.regs[id-1]
	return &r, nil
}

func (m *Memory) CountPendingRegistrations(context.Context) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.regs {
		if r.Status == RegistrationPending {
			n++
		}
	}
	return n, nil
}

func (m *Memory) DecideRegistration(_ context.Context, id int64, status RegistrationStatus, actor, userSub string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id < 1 || id > int64(len(m.regs)) {
		return ErrNotFound
	}
	r := &m.regs[id-1]
	if r.Status != RegistrationPending {
		return ErrConflict
	}
	now := time.Now().UTC()
	r.Status, r.DecidedAt, r.DecidedBy, r.UserSub = status, &now, actor, userSub
	return nil
}
