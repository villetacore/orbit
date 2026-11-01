package api

import (
	"crypto/subtle"
	"encoding/json"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/oauth2"

	"github.com/villetacore/orbit/backend/internal/seal"
)

// authState travels in a sealed, short-lived cookie between /auth/login and
// /auth/callback; it carries the PKCE verifier, so it never reaches the IdP.
type authState struct {
	State    string    `json:"s"`
	Nonce    string    `json:"n"`
	Verifier string    `json:"v"`
	ReturnTo string    `json:"r"`
	Expires  time.Time `json:"e"`
}

const authStateTTL = 10 * time.Minute

var authStateAAD = []byte("orbit-auth-state")

// Keycloak application-initiated actions a user may trigger from Orbit.
// Keycloak re-authenticates the user before applying them.
var allowedActions = map[string]bool{
	"UPDATE_PASSWORD":   true,
	"CONFIGURE_TOTP":    true,
	"webauthn-register": true,
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	s.startLogin(w, r, safeReturnTo(r.URL.Query().Get("return_to")), nil)
}

// deleteCredentialAction is Keycloak's parameterized AIA for removing one of
// the user's own credentials ("delete_credential:<id>"); Keycloak checks that
// the credential belongs to the re-authenticated user.
const deleteCredentialAction = "delete_credential:"

func validAction(action string) bool {
	if id, ok := strings.CutPrefix(action, deleteCredentialAction); ok {
		return isKeycloakID(id)
	}
	return allowedActions[action]
}

// isKeycloakID accepts Keycloak entity IDs (UUIDs) and nothing that could
// break out of a path segment or query value.
func isKeycloakID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	action := chi.URLParam(r, "action")
	if !validAction(action) {
		writeError(w, http.StatusBadRequest, "bad_action", "Неподдерживаемое действие")
		return
	}
	s.startLogin(w, r, "/security", map[string]string{"kc_action": action})
}

func (s *Server) startLogin(w http.ResponseWriter, r *http.Request, returnTo string, extra map[string]string) {
	st := authState{
		State:    seal.RandomToken(24),
		Nonce:    seal.RandomToken(24),
		Verifier: oauth2.GenerateVerifier(),
		ReturnTo: returnTo,
		Expires:  time.Now().Add(authStateTTL),
	}
	b, _ := json.Marshal(st)
	s.setCookie(w, authCookie, s.sealer.Seal(b, authStateAAD), "/auth", int(authStateTTL.Seconds()))
	http.Redirect(w, r, s.oidc.AuthCodeURL(st.State, st.Nonce, st.Verifier, extra), http.StatusFound)
}

func (s *Server) handleCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	c, err := r.Cookie(authCookie)
	if err != nil {
		s.loginFailed(w, r, "missing auth state cookie")
		return
	}
	s.clearCookie(w, authCookie, "/auth")
	plain, err := s.sealer.Open(c.Value, authStateAAD)
	var st authState
	if err != nil || json.Unmarshal(plain, &st) != nil || time.Now().After(st.Expires) {
		s.loginFailed(w, r, "invalid or expired auth state")
		return
	}
	if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(st.State)) != 1 {
		s.loginFailed(w, r, "state mismatch")
		return
	}

	returnTo := st.ReturnTo
	if status := q.Get("kc_action_status"); status != "" {
		returnTo = withQuery(returnTo, "kc_action_status", status)
	}
	if e := q.Get("error"); e != "" {
		// A failed application-initiated action still leaves the user signed in.
		if prev, err := s.currentSession(r); err == nil && prev != nil {
			http.Redirect(w, r, withQuery(returnTo, "kc_action_status", "error"), http.StatusFound)
			return
		}
		s.loginFailed(w, r, "idp error: "+e)
		return
	}

	claims, tokens, err := s.oidc.Exchange(r.Context(), q.Get("code"), st.Verifier, st.Nonce)
	if err != nil {
		s.loginFailed(w, r, err.Error())
		return
	}

	// Rotate the session on every login to prevent fixation.
	if old, err := r.Cookie(sessionCookie); err == nil {
		_ = s.sessions.Delete(r.Context(), old.Value)
	}
	sess, err := s.sessions.Create(r.Context(), claims, tokens)
	if err != nil {
		s.log.Error("create session", "err", err)
		s.loginFailed(w, r, "session store error")
		return
	}
	if err := s.store.TouchProfile(r.Context(), claims.Subject); err != nil {
		s.log.Error("touch profile", "err", err)
	}
	s.setCookie(w, sessionCookie, sess.ID, "/", int(time.Until(sess.ExpiresAt).Seconds()))
	s.audit(r, claims.Subject, "auth.login", claims.Subject, nil)
	http.Redirect(w, r, returnTo, http.StatusFound)
}

func (s *Server) loginFailed(w http.ResponseWriter, r *http.Request, reason string) {
	s.log.Warn("login failed", "reason", reason)
	http.Redirect(w, r, "/?error=login_failed", http.StatusFound)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r.Context())
	if err := s.sessions.Delete(r.Context(), sess.ID); err != nil {
		s.log.Error("delete session", "err", err)
	}
	s.clearCookie(w, sessionCookie, "/")
	s.audit(r, sess.Claims.Subject, "auth.logout", sess.Claims.Subject, nil)
	writeJSON(w, http.StatusOK, map[string]string{
		"redirectUrl": s.oidc.LogoutURL(sess.Tokens.IDToken, s.cfg.PublicURL+"/"),
	})
}

// safeReturnTo only accepts same-origin relative paths to avoid open redirects.
func safeReturnTo(raw string) string {
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.ContainsAny(raw, "\\\r\n\t") {
		return "/"
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil {
		return "/"
	}
	if strings.HasPrefix(u.Path, "/auth/") {
		return "/"
	}
	return u.RequestURI()
}

func withQuery(path, key, value string) string {
	u, err := url.Parse(path)
	if err != nil {
		return path
	}
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	return u.String()
}

type meResponse struct {
	Sub       string   `json:"sub"`
	Username  string   `json:"username"`
	Name      string   `json:"name"`
	Email     string   `json:"email"`
	Roles     []string `json:"roles"`
	Groups    []string `json:"groups"`
	IsAdmin   bool     `json:"isAdmin"`
	AvatarURL string   `json:"avatarUrl"`
	CSRFToken string   `json:"csrfToken"`
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r.Context())
	c := sess.Claims
	writeJSON(w, http.StatusOK, meResponse{
		Sub:       c.Subject,
		Username:  c.PreferredUsername,
		Name:      c.Name,
		Email:     c.Email,
		Roles:     displayRoles(c.Roles),
		Groups:    nonNil(c.Groups),
		IsAdmin:   c.HasRole(s.cfg.AdminRole),
		AvatarURL: s.avatarURLFor(r, c.Subject),
		CSRFToken: sess.CSRFToken,
	})
}

type configResponse struct {
	AccountConsoleURL   string            `json:"accountConsoleUrl"`
	SecurityLinks       map[string]string `json:"securityLinks"`
	Actions             []string          `json:"actions"`
	RegistrationEnabled bool              `json:"registrationEnabled"`
}

func (s *Server) handleConfig(w http.ResponseWriter, _ *http.Request) {
	acc := s.cfg.AccountConsoleURL()
	actions := slices.Sorted(maps.Keys(allowedActions))
	writeJSON(w, http.StatusOK, configResponse{
		AccountConsoleURL: acc,
		SecurityLinks: map[string]string{
			"signingIn":      acc + "/account-security/signing-in",
			"deviceActivity": acc + "/account-security/device-activity",
			"linkedAccounts": acc + "/account-security/linked-accounts",
			"applications":   acc + "/applications",
		},
		Actions:             actions,
		RegistrationEnabled: s.cfg.RegistrationEnabled,
	})
}

// displayRoles hides Keycloak's technical default roles.
func displayRoles(roles []string) []string {
	out := []string{}
	for _, r := range roles {
		if r == "offline_access" || r == "uma_authorization" || strings.HasPrefix(r, "default-roles-") {
			continue
		}
		out = append(out, r)
	}
	return out
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
