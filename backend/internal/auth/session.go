package auth

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/villetacore/orbit/backend/internal/seal"
)

var ErrNoSession = errors.New("auth: session not found")

// Session is stored server-side; the browser only holds the opaque ID.
type Session struct {
	ID        string    `json:"-"`
	Claims    Claims    `json:"claims"`
	Tokens    Tokens    `json:"tokens"`
	CSRFToken string    `json:"csrf"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Repo persists sealed session payloads keyed by the hash of the session ID.
// LoadSession returns ErrNoSession for missing or expired sessions.
type Repo interface {
	SaveSession(ctx context.Context, idHash, sub string, payload []byte, expiresAt time.Time) error
	LoadSession(ctx context.Context, idHash string) ([]byte, error)
	DeleteSession(ctx context.Context, idHash string) error
}

type Manager struct {
	repo   Repo
	sealer *seal.Sealer
	ttl    time.Duration
	now    func() time.Time
}

func NewManager(repo Repo, sealer *seal.Sealer, ttl time.Duration) *Manager {
	return &Manager{repo: repo, sealer: sealer, ttl: ttl, now: time.Now}
}

func (m *Manager) Create(ctx context.Context, claims Claims, tokens Tokens) (*Session, error) {
	now := m.now()
	s := &Session{
		ID:        seal.RandomToken(32),
		Claims:    claims,
		Tokens:    tokens,
		CSRFToken: seal.RandomToken(32),
		CreatedAt: now,
		ExpiresAt: now.Add(m.ttl),
	}
	return s, m.Save(ctx, s)
}

func (m *Manager) Save(ctx context.Context, s *Session) error {
	plain, err := json.Marshal(s)
	if err != nil {
		return err
	}
	idHash := seal.Hash(s.ID)
	sealed := m.sealer.Seal(plain, []byte(idHash))
	return m.repo.SaveSession(ctx, idHash, s.Claims.Subject, []byte(sealed), s.ExpiresAt)
}

func (m *Manager) Get(ctx context.Context, id string) (*Session, error) {
	if id == "" {
		return nil, ErrNoSession
	}
	idHash := seal.Hash(id)
	payload, err := m.repo.LoadSession(ctx, idHash)
	if err != nil {
		return nil, err
	}
	plain, err := m.sealer.Open(string(payload), []byte(idHash))
	if err != nil {
		return nil, ErrNoSession
	}
	var s Session
	if err := json.Unmarshal(plain, &s); err != nil {
		return nil, ErrNoSession
	}
	if !m.now().Before(s.ExpiresAt) {
		_ = m.repo.DeleteSession(ctx, idHash)
		return nil, ErrNoSession
	}
	s.ID = id
	return &s, nil
}

func (m *Manager) Delete(ctx context.Context, id string) error {
	return m.repo.DeleteSession(ctx, seal.Hash(id))
}

// MemoryRepo is an in-process Repo used by tests.
type MemoryRepo struct {
	mu   sync.Mutex
	data map[string]memEntry
}

type memEntry struct {
	payload   []byte
	expiresAt time.Time
}

func NewMemoryRepo() *MemoryRepo { return &MemoryRepo{data: map[string]memEntry{}} }

func (r *MemoryRepo) SaveSession(_ context.Context, idHash, _ string, payload []byte, expiresAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.data[idHash] = memEntry{payload: payload, expiresAt: expiresAt}
	return nil
}

func (r *MemoryRepo) LoadSession(_ context.Context, idHash string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.data[idHash]
	if !ok || !time.Now().Before(e.expiresAt) {
		return nil, ErrNoSession
	}
	return e.payload, nil
}

func (r *MemoryRepo) DeleteSession(_ context.Context, idHash string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.data, idHash)
	return nil
}

func (r *MemoryRepo) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.data)
}
