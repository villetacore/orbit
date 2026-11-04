package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	qrcode "github.com/skip2/go-qrcode"

	"github.com/villetacore/orbit/backend/internal/auth"
	"github.com/villetacore/orbit/backend/internal/keycloak"
	"github.com/villetacore/orbit/backend/internal/totp"
)

// The user's own Keycloak account, managed from Orbit instead of the Account
// Console. Changes that could take over an account (password, email, sign-in
// methods) re-check the current password first; ending a session or revoking an
// application needs only the Orbit session.

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

// verifyCurrentPassword re-checks the password before a sensitive change, the
// way Keycloak's own pages re-authenticate. The session this creates in
// Keycloak is ended right away. It writes the error response on failure.
func (s *Server) verifyCurrentPassword(w http.ResponseWriter, r *http.Request, password, otp string) bool {
	claims := sessionFrom(r.Context()).Claims
	if password == "" {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Введите текущий пароль")
		return false
	}
	_, tokens, err := s.oidc.Login(r.Context(), auth.PasswordLogin{
		Username: claims.PreferredUsername, Password: password, OTP: strings.TrimSpace(otp), ClientIP: clientIP(r),
	})
	switch {
	case err == nil:
		if err := s.oidc.EndSession(r.Context(), tokens.RefreshToken); err != nil {
			s.log.Warn("end verification session", "sub", claims.Subject, "err", err)
		}
		return true
	case errors.Is(err, auth.ErrAccountSetup):
		// Only reported once the credentials have been accepted.
		return true
	case errors.Is(err, auth.ErrInvalidCredentials), errors.Is(err, auth.ErrAccountDisabled):
		writeError(w, http.StatusForbidden, "invalid_password", "Неверный текущий пароль или код подтверждения")
	case errors.Is(err, auth.ErrPasswordGrantDisabled):
		s.log.Error("verify password: enable Direct access grants on the Orbit client in Keycloak", "client", s.cfg.ClientID)
		writeError(w, http.StatusBadGateway, "keycloak", "В Keycloak отключён вход по паролю для клиента Orbit")
	default:
		s.log.Error("verify password", "err", err)
		writeError(w, http.StatusBadGateway, "keycloak", "Сервис идентификации недоступен")
	}
	return false
}

type reauth struct {
	CurrentPassword string `json:"currentPassword"`
	OTP             string `json:"otp"`
}

func (s *Server) handleAccountPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		reauth
		NewPassword string `json:"newPassword"`
		// LogoutOthers also ends the user's other sessions.
		LogoutOthers bool `json:"logoutOthers"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.NewPassword == "" {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Введите новый пароль")
		return
	}
	if in.NewPassword == in.CurrentPassword {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Новый пароль должен отличаться от текущего")
		return
	}
	if !s.verifyCurrentPassword(w, r, in.CurrentPassword, in.OTP) {
		return
	}
	sess := sessionFrom(r.Context())
	sub := sess.Claims.Subject
	if err := s.kc.SetPassword(r.Context(), sub, in.NewPassword, false); err != nil {
		s.keycloakError(w, err)
		return
	}
	ended := 0
	if in.LogoutOthers && sess.Claims.SessionID != "" {
		ss, err := s.kc.UserSessions(r.Context(), sub)
		if err != nil {
			s.log.Warn("list sessions after password change", "sub", sub, "err", err)
		}
		for _, k := range ss {
			if k.ID == sess.Claims.SessionID {
				continue
			}
			if err := s.kc.DeleteSession(r.Context(), k.ID); err != nil {
				s.log.Warn("end session after password change", "sub", sub, "err", err)
				continue
			}
			ended++
		}
	}
	s.audit(r, sub, "account.password.change", sub, map[string]any{"endedSessions": ended})
	writeJSON(w, http.StatusOK, map[string]int{"endedSessions": ended})
}

func (s *Server) handleAccountEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		reauth
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	email := strings.TrimSpace(in.Email)
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email || len(email) > 254 {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Введите полный адрес, например name@company.ru")
		return
	}
	if !s.verifyCurrentPassword(w, r, in.CurrentPassword, in.OTP) {
		return
	}
	sub := sessionFrom(r.Context()).Claims.Subject
	u, err := s.kc.GetUser(r.Context(), sub)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	verification := "unchanged"
	if !strings.EqualFold(email, u.Email) {
		u.Email = email
		u.EmailVerified = false
		if err := s.kc.UpdateUser(r.Context(), u); err != nil {
			if errors.Is(err, keycloak.ErrConflict) {
				writeError(w, http.StatusConflict, "conflict", "Этот email уже занят")
				return
			}
			s.keycloakError(w, err)
			return
		}
		// The change stands even if no mail server is configured.
		verification = "sent"
		if err := s.kc.SendVerifyEmail(r.Context(), sub); err != nil {
			s.log.Warn("send verify email", "sub", sub, "err", err)
			verification = "failed"
		}
		s.audit(r, sub, "account.email.change", sub, nil)
	}
	writeJSON(w, http.StatusOK, map[string]string{"email": email, "verification": verification})
}

func (s *Server) handleAccountVerifyEmail(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	if err := s.kc.SendVerifyEmail(r.Context(), sub); err != nil {
		s.log.Error("send verify email", "sub", sub, "err", err)
		writeError(w, http.StatusBadGateway, "keycloak", "Keycloak не отправил письмо. Проверьте, настроена ли почта в realm")
		return
	}
	s.audit(r, sub, "account.email.verify_sent", sub, nil)
	w.WriteHeader(http.StatusNoContent)
}

// TOTP enrollment. Keycloak's Admin API stores a credential but offers no
// enrollment ceremony, so Orbit runs it: the secret goes into a sealed token
// held by the browser, and is stored only after the user proves it with a code
// from their authenticator.

const totpSetupTTL = 10 * time.Minute

var totpSetupAAD = []byte("orbit-totp-setup")

type totpSetup struct {
	Sub       string      `json:"s"`
	Secret    string      `json:"k"`
	Params    totp.Params `json:"p"`
	LookAhead int         `json:"l"`
	Expires   time.Time   `json:"e"`
}

func (s *Server) handleAccountTOTPSetup(w http.ResponseWriter, r *http.Request) {
	claims := sessionFrom(r.Context()).Claims
	realm, err := s.kc.GetRealm(r.Context())
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	params := totp.Params{Digits: realm.OTPPolicyDigits, Period: realm.OTPPolicyPeriod, Algorithm: realm.OTPPolicyAlgorithm}
	if realm.OTPPolicyType != "totp" || !params.Supported() {
		writeError(w, http.StatusUnprocessableEntity, "unsupported_policy", "Политика OTP в realm не поддерживается: нужен TOTP на 6–8 цифр")
		return
	}
	setup := totpSetup{
		Sub: claims.Subject, Secret: totp.NewSecret(), Params: params,
		LookAhead: realm.OTPPolicyLookAhead, Expires: time.Now().Add(totpSetupTTL),
	}
	b, err := json.Marshal(setup)
	if err != nil {
		s.internalError(w, "marshal totp setup", err)
		return
	}
	issuer := realm.DisplayName
	if issuer == "" {
		issuer = s.cfg.Realm
	}
	uri := totp.URI(params, setup.Secret, issuer, claims.PreferredUsername)
	qr, err := qrcode.Encode(uri, qrcode.Medium, 320)
	if err != nil {
		s.internalError(w, "render totp qr", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"setupToken": s.sealer.Seal(b, totpSetupAAD),
		"secret":     totp.EncodeSecret(setup.Secret),
		"uri":        uri,
		"qrImage":    "data:image/png;base64," + base64.StdEncoding.EncodeToString(qr),
		"digits":     params.Digits,
		"period":     params.Period,
		"algorithm":  strings.TrimPrefix(params.Algorithm, "Hmac"),
	})
}

func (s *Server) handleAccountTOTPConfirm(w http.ResponseWriter, r *http.Request) {
	var in struct {
		reauth
		SetupToken string `json:"setupToken"`
		Code       string `json:"code"`
		Label      string `json:"label"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	sub := sessionFrom(r.Context()).Claims.Subject
	var setup totpSetup
	plain, err := s.sealer.Open(in.SetupToken, totpSetupAAD)
	if err != nil || json.Unmarshal(plain, &setup) != nil || setup.Sub != sub || time.Now().After(setup.Expires) {
		writeError(w, http.StatusUnprocessableEntity, "setup_expired", "Время настройки истекло. Начните заново")
		return
	}
	label, err := cleanText(in.Label, 0, 64)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Название: "+err.Error())
		return
	}
	// Check the cheap, local proof first: a mistyped code must not count as a
	// failed password attempt in Keycloak.
	if !totp.Verify(setup.Params, setup.Secret, in.Code, time.Now(), setup.LookAhead) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_code", "Код не подошёл. Проверьте время на устройстве и попробуйте ещё раз")
		return
	}
	if !s.verifyCurrentPassword(w, r, in.CurrentPassword, in.OTP) {
		return
	}
	err = s.kc.AddOTPCredential(r.Context(), sub, keycloak.OTPCredential{
		Secret: setup.Secret, Label: label,
		Digits: setup.Params.Digits, Period: setup.Params.Period, Algorithm: setup.Params.Algorithm,
	})
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	s.audit(r, sub, "account.totp.add", sub, nil)
	w.WriteHeader(http.StatusNoContent)
}

// ownCredential finds a credential of the signed-in user; someone else's looks
// like a missing one.
func (s *Server) ownCredential(w http.ResponseWriter, r *http.Request) (*keycloak.Credential, bool) {
	sub := sessionFrom(r.Context()).Claims.Subject
	id := chi.URLParam(r, "id")
	cs, err := s.kc.UserCredentials(r.Context(), sub)
	if err != nil {
		s.keycloakError(w, err)
		return nil, false
	}
	i := slices.IndexFunc(cs, func(c keycloak.Credential) bool { return c.ID == id })
	if i < 0 {
		writeError(w, http.StatusNotFound, "not_found", "Способ входа не найден")
		return nil, false
	}
	return &cs[i], true
}

func (s *Server) handleAccountDeleteCredential(w http.ResponseWriter, r *http.Request) {
	var in reauth
	if !decodeJSON(w, r, &in) {
		return
	}
	c, ok := s.ownCredential(w, r)
	if !ok {
		return
	}
	if c.Type == "password" {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Пароль можно сменить, но не удалить")
		return
	}
	if !s.verifyCurrentPassword(w, r, in.CurrentPassword, in.OTP) {
		return
	}
	sub := sessionFrom(r.Context()).Claims.Subject
	if err := s.kc.DeleteCredential(r.Context(), sub, c.ID); err != nil {
		s.keycloakError(w, err)
		return
	}
	s.audit(r, sub, "account.credential.delete", sub, map[string]any{"type": c.Type})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAccountRenameCredential(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Label string `json:"label"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	label, err := cleanText(in.Label, 1, 64)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Название: "+err.Error())
		return
	}
	c, ok := s.ownCredential(w, r)
	if !ok {
		return
	}
	sub := sessionFrom(r.Context()).Claims.Subject
	if err := s.kc.SetCredentialLabel(r.Context(), sub, c.ID, label); err != nil {
		s.keycloakError(w, err)
		return
	}
	s.audit(r, sub, "account.credential.rename", sub, nil)
	w.WriteHeader(http.StatusNoContent)
}

type linkedAccount struct {
	Alias       string `json:"alias"`
	DisplayName string `json:"displayName"`
	Linked      bool   `json:"linked"`
	UserName    string `json:"userName"`
}

// handleAccountLinked lists the realm's enabled identity providers and which of
// them the user has linked; a disabled provider still shows while linked.
func (s *Server) handleAccountLinked(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	providers, err := s.kc.IdentityProviders(r.Context())
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	linked, err := s.kc.FederatedIdentities(r.Context(), sub)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	out := []linkedAccount{}
	for _, p := range providers {
		i := slices.IndexFunc(linked, func(f keycloak.FederatedIdentity) bool { return f.IdentityProvider == p.Alias })
		if !p.Enabled && i < 0 {
			continue
		}
		a := linkedAccount{Alias: p.Alias, DisplayName: p.DisplayName, Linked: i >= 0}
		if a.DisplayName == "" {
			a.DisplayName = p.Alias
		}
		if i >= 0 {
			a.UserName = linked[i].UserName
		}
		out = append(out, a)
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": out})
}

func (s *Server) handleAccountUnlink(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	provider := chi.URLParam(r, "provider")
	if err := s.kc.DeleteFederatedIdentity(r.Context(), sub, provider); err != nil {
		s.keycloakError(w, err)
		return
	}
	s.audit(r, sub, "account.identity.unlink", sub, map[string]any{"provider": provider})
	w.WriteHeader(http.StatusNoContent)
}

type consentView struct {
	ClientID  string     `json:"clientId"`
	Scopes    []string   `json:"scopes"`
	UpdatedAt *time.Time `json:"updatedAt"`
}

func (s *Server) handleAccountConsents(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	cs, err := s.kc.UserConsents(r.Context(), sub)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	out := make([]consentView, 0, len(cs))
	for _, c := range cs {
		v := consentView{ClientID: c.ClientID, Scopes: nonNil(c.GrantedClientScopes)}
		if c.LastUpdatedDate > 0 {
			t := time.UnixMilli(c.LastUpdatedDate).UTC()
			v.UpdatedAt = &t
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"consents": out})
}

func (s *Server) handleAccountRevokeConsent(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	client := chi.URLParam(r, "client")
	if err := s.kc.DeleteConsent(r.Context(), sub, client); err != nil {
		s.keycloakError(w, err)
		return
	}
	s.audit(r, sub, "account.consent.revoke", sub, map[string]any{"client": client})
	w.WriteHeader(http.StatusNoContent)
}

type eventView struct {
	Time      time.Time `json:"time"`
	Type      string    `json:"type"`
	Client    string    `json:"client"`
	IPAddress string    `json:"ipAddress"`
	Error     string    `json:"error"`
}

const accountEventsLimit = 30

// handleAccountEvents is the user's own sign-in history. Details are left out:
// they carry token IDs.
func (s *Server) handleAccountEvents(w http.ResponseWriter, r *http.Request) {
	sub := sessionFrom(r.Context()).Claims.Subject
	es, err := s.kc.UserEvents(r.Context(), sub, accountEventsLimit)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	out := make([]eventView, 0, len(es))
	for _, e := range es {
		out = append(out, eventView{
			Time: time.UnixMilli(e.Time).UTC(), Type: e.Type, Client: e.ClientID, IPAddress: e.IPAddress, Error: e.Error,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": out})
}
