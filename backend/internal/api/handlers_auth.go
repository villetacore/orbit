package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/oauth2"

	"github.com/villetacore/orbit/backend/internal/auth"
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

// Keycloak application-initiated actions a user may trigger from Orbit. Only
// what cannot work without Keycloak's own origin stays here: WebAuthn keys are
// bound to it, and linking an account is a redirect to the external provider.
// Keycloak re-authenticates the user before applying them.
var allowedActions = map[string]bool{
	"webauthn-register":              true,
	"webauthn-register-passwordless": true,
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	s.startLogin(w, r, safeReturnTo(r.URL.Query().Get("return_to")), nil)
}

// linkAccountAction is Keycloak's parameterized AIA for linking an external
// identity provider ("idp_link:<alias>").
const linkAccountAction = "idp_link:"

func validAction(action string) bool {
	if alias, ok := strings.CutPrefix(action, linkAccountAction); ok {
		return isKeycloakID(alias)
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
	if err := s.establishSession(w, r, claims, tokens); err != nil {
		s.log.Error("create session", "err", err)
		s.loginFailed(w, r, "session store error")
		return
	}
	http.Redirect(w, r, returnTo, http.StatusFound)
}

// establishSession opens the Orbit session after any kind of successful login.
func (s *Server) establishSession(w http.ResponseWriter, r *http.Request, claims auth.Claims, tokens auth.Tokens) error {
	// Rotate the session on every login to prevent fixation.
	if old, err := r.Cookie(sessionCookie); err == nil {
		_ = s.sessions.Delete(r.Context(), old.Value)
	}
	sess, err := s.sessions.Create(r.Context(), claims, tokens)
	if err != nil {
		return err
	}
	if err := s.store.TouchProfile(r.Context(), claims.Subject); err != nil {
		s.log.Error("touch profile", "err", err)
	}
	s.setCookie(w, sessionCookie, sess.ID, "/", int(time.Until(sess.ExpiresAt).Seconds()))
	s.audit(r, claims.Subject, "auth.login", claims.Subject, nil)
	return nil
}

type passwordLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	OTP      string `json:"otp"`
	// NewPassword completes a sign-in with a temporary password.
	NewPassword string `json:"newPassword"`
}

// handlePasswordLogin signs the user in from Orbit's own form. There is no
// session yet to carry a CSRF token, so the Origin must match and the body must
// be JSON, which a cross-site form cannot send without a CORS preflight.
func (s *Server) handlePasswordLogin(w http.ResponseWriter, r *http.Request) {
	if o := r.Header.Get("Origin"); o != "" && o != s.cfg.PublicURL {
		writeError(w, http.StatusForbidden, "bad_origin", "Запрос с недопустимого источника")
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "bad_request", "Ожидается JSON")
		return
	}
	var in passwordLoginRequest
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if in.Username == "" || in.Password == "" {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Введите логин и пароль")
		return
	}
	login := auth.PasswordLogin{Username: in.Username, Password: in.Password, OTP: strings.TrimSpace(in.OTP), ClientIP: clientIP(r)}
	claims, tokens, err := s.oidc.Login(r.Context(), login)
	if errors.Is(err, auth.ErrAccountSetup) {
		// Keycloak says this only after the password and code checked out.
		if !s.finishAccountSetup(w, r, in) {
			return
		}
		login.Password = in.NewPassword
		claims, tokens, err = s.oidc.Login(r.Context(), login)
	}
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrInvalidCredentials), errors.Is(err, auth.ErrAccountDisabled):
		// A disabled account gets the same answer: the form must not reveal
		// which logins exist.
		s.log.Info("password login rejected", "err", err)
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Неверный логин, пароль или код подтверждения")
		return
	case errors.Is(err, auth.ErrAccountSetup):
		writeBrowserRequired(w)
		return
	case errors.Is(err, auth.ErrPasswordGrantDisabled):
		s.log.Error("password login: enable Direct access grants on the Orbit client in Keycloak", "client", s.cfg.ClientID)
		writeBrowserRequired(w)
		return
	default:
		s.log.Error("password login", "err", err)
		writeError(w, http.StatusBadGateway, "keycloak", "Сервис идентификации недоступен")
		return
	}
	if err := s.establishSession(w, r, claims, tokens); err != nil {
		s.log.Error("create session", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Не удалось создать сессию")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// writeBrowserRequired tells the form to fall back to Keycloak's own pages for
// what Orbit cannot do inline, such as a required action other than a password.
func writeBrowserRequired(w http.ResponseWriter) {
	writeError(w, http.StatusConflict, "browser_required", "Для этой учётной записи нужно завершить настройку на странице единого входа")
}

// finishAccountSetup handles the required action Orbit can do itself, replacing
// a temporary password. It returns true when the login should be retried, and
// otherwise writes the response. The caller has already proven the credentials.
func (s *Server) finishAccountSetup(w http.ResponseWriter, r *http.Request, in passwordLoginRequest) bool {
	u, err := s.kc.FindUserByLogin(r.Context(), in.Username)
	if err != nil {
		s.keycloakError(w, err)
		return false
	}
	if !slices.Contains(u.RequiredActions, "UPDATE_PASSWORD") {
		writeBrowserRequired(w)
		return false
	}
	if in.NewPassword == "" {
		writeError(w, http.StatusConflict, "password_change_required", "Задайте новый пароль, чтобы завершить вход")
		return false
	}
	if in.NewPassword == in.Password {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Новый пароль должен отличаться от временного")
		return false
	}
	if err := s.kc.SetPassword(r.Context(), u.ID, in.NewPassword, false); err != nil {
		s.keycloakError(w, err)
		return false
	}
	s.audit(r, u.ID, "auth.password.first_change", u.ID, nil)
	return true
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
	// The Orbit session is gone either way; a Keycloak failure must not keep
	// the user signed in here, and the session expires there on its own.
	if err := s.oidc.EndSession(r.Context(), sess.Tokens.RefreshToken); err != nil {
		s.log.Warn("end keycloak session", "sub", sess.Claims.Subject, "err", err)
	}
	s.audit(r, sess.Claims.Subject, "auth.logout", sess.Claims.Subject, nil)
	w.WriteHeader(http.StatusNoContent)
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
	Actions             []string `json:"actions"`
	RegistrationEnabled bool     `json:"registrationEnabled"`
}

func (s *Server) handleConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, configResponse{
		Actions:             slices.Sorted(maps.Keys(allowedActions)),
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
