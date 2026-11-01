package api

import (
	"net/http"
	"slices"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/villetacore/orbit/backend/internal/keycloak"
)

// The user's own Keycloak account: sessions and sign-in methods, managed from
// Orbit instead of the Account Console. Removing a credential goes through the
// delete_credential application-initiated action, so Keycloak re-authenticates
// the user first; ending a session needs only the Orbit session.

type sessionView struct {
	ID         string    `json:"id"`
	IPAddress  string    `json:"ipAddress"`
	Started    time.Time `json:"started"`
	LastAccess time.Time `json:"lastAccess"`
	Clients    []string  `json:"clients"`
	Current    bool      `json:"current"`
}

func sessionViews(ss []keycloak.Session, currentID string) []sessionView {
	out := make([]sessionView, 0, len(ss))
	for _, s := range ss {
		v := sessionView{
			ID:         s.ID,
			IPAddress:  s.IPAddress,
			Started:    time.UnixMilli(s.Start).UTC(),
			LastAccess: time.UnixMilli(s.LastAccess).UTC(),
			Clients:    []string{},
			Current:    currentID != "" && s.ID == currentID,
		}
		for _, name := range s.Clients {
			v.Clients = append(v.Clients, name)
		}
		slices.Sort(v.Clients)
		out = append(out, v)
	}
	// Current session first, then most recently active.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Current != out[j].Current {
			return out[i].Current
		}
		return out[i].LastAccess.After(out[j].LastAccess)
	})
	return out
}

func (s *Server) handleAccountSessions(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r.Context())
	ss, err := s.kc.UserSessions(r.Context(), sess.Claims.Subject)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessionViews(ss, sess.Claims.SessionID)})
}

// handleAccountEndSession ends one of the user's own sessions; the ID must be
// in the user's session list, so nobody can end someone else's session.
func (s *Server) handleAccountEndSession(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r.Context())
	id := chi.URLParam(r, "id")
	ss, err := s.kc.UserSessions(r.Context(), sess.Claims.Subject)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	if !slices.ContainsFunc(ss, func(k keycloak.Session) bool { return k.ID == id }) {
		writeError(w, http.StatusNotFound, "not_found", "Сессия не найдена")
		return
	}
	if err := s.kc.DeleteSession(r.Context(), id); err != nil {
		s.keycloakError(w, err)
		return
	}
	s.audit(r, sess.Claims.Subject, "account.session.end", sess.Claims.Subject, map[string]any{"current": id == sess.Claims.SessionID})
	w.WriteHeader(http.StatusNoContent)
}

// handleAccountEndOtherSessions ends every session except the current one.
func (s *Server) handleAccountEndOtherSessions(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r.Context())
	ss, err := s.kc.UserSessions(r.Context(), sess.Claims.Subject)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	ended := 0
	for _, k := range ss {
		// Without a known current session ID, keep everything rather than
		// logging the user out of Orbit itself.
		if sess.Claims.SessionID == "" || k.ID == sess.Claims.SessionID {
			continue
		}
		if err := s.kc.DeleteSession(r.Context(), k.ID); err != nil {
			s.keycloakError(w, err)
			return
		}
		ended++
	}
	s.audit(r, sess.Claims.Subject, "account.session.end_others", sess.Claims.Subject, map[string]any{"count": ended})
	writeJSON(w, http.StatusOK, map[string]int{"ended": ended})
}

type credentialView struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Label     string     `json:"label"`
	CreatedAt *time.Time `json:"createdAt"`
	// Removable credentials can be deleted through delete_credential; the
	// password is replaced, never removed.
	Removable bool `json:"removable"`
}

func credentialViews(cs []keycloak.Credential) []credentialView {
	out := make([]credentialView, 0, len(cs))
	for _, c := range cs {
		v := credentialView{ID: c.ID, Type: c.Type, Label: c.UserLabel, Removable: c.Type != "password"}
		if c.CreatedDate > 0 {
			t := time.UnixMilli(c.CreatedDate).UTC()
			v.CreatedAt = &t
		}
		out = append(out, v)
	}
	return out
}

func (s *Server) handleAccountCredentials(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	cs, err := s.kc.UserCredentials(r.Context(), sub)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"credentials": credentialViews(cs)})
}
