package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/villetacore/orbit/backend/internal/auth"
	"github.com/villetacore/orbit/backend/internal/keycloak"
	"github.com/villetacore/orbit/backend/internal/totp"
)

func (h *harness) passwordLogin(body map[string]string) *http.Response {
	h.t.Helper()
	b, _ := json.Marshal(body)
	return h.do("POST", "/auth/password", bytes.NewReader(b), map[string]string{"Content-Type": "application/json", "Origin": publicURL})
}

func errorCode(t *testing.T, resp *http.Response) string {
	t.Helper()
	var e apiError
	if err := json.NewDecoder(resp.Body).Decode(&e); err != nil {
		t.Fatal(err)
	}
	return e.Error
}

func TestPasswordLoginOpensSessionWithoutRedirect(t *testing.T) {
	h := newHarness(t)
	resp := h.passwordLogin(map[string]string{"username": " alice ", "password": "secret"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if h.oidc.logins[0].Username != "alice" {
		t.Fatalf("username not trimmed: %q", h.oidc.logins[0].Username)
	}
	var me meResponse
	h.decode(h.do("GET", "/api/me", nil, nil), http.StatusOK, &me)
	if me.Sub != "user-1" {
		t.Fatalf("me: %+v", me)
	}
	if !slices.Contains(h.store.AuditActions(), "auth.login") {
		t.Fatal("login not audited")
	}
}

func TestPasswordLoginHidesWhyItFailed(t *testing.T) {
	h := newHarness(t)
	wrong := h.passwordLogin(map[string]string{"username": "alice", "password": "nope"})
	if wrong.StatusCode != http.StatusUnauthorized || errorCode(t, wrong) != "invalid_credentials" {
		t.Fatalf("wrong password: %d", wrong.StatusCode)
	}
	h.oidc.loginErr = auth.ErrAccountDisabled
	disabled := h.passwordLogin(map[string]string{"username": "alice", "password": "secret"})
	if disabled.StatusCode != http.StatusUnauthorized || errorCode(t, disabled) != "invalid_credentials" {
		t.Fatalf("disabled account distinguishable: %d", disabled.StatusCode)
	}
	h.oidc.loginErr = errors.New("connection refused")
	if resp := h.passwordLogin(map[string]string{"username": "alice", "password": "secret"}); resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("idp down: %d", resp.StatusCode)
	}
}

func TestPasswordLoginPassesOTP(t *testing.T) {
	h := newHarness(t)
	h.oidc.otp = "123456"
	if resp := h.passwordLogin(map[string]string{"username": "alice", "password": "secret"}); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no code: %d", resp.StatusCode)
	}
	if resp := h.passwordLogin(map[string]string{"username": "alice", "password": "secret", "otp": "123456"}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("with code: %d", resp.StatusCode)
	}
}

func TestPasswordLoginRejectsCrossSiteRequests(t *testing.T) {
	h := newHarness(t)
	b := strings.NewReader(`{"username":"alice","password":"secret"}`)
	if resp := h.do("POST", "/auth/password", b, map[string]string{"Content-Type": "application/json", "Origin": "https://evil.test"}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", resp.StatusCode)
	}
	b = strings.NewReader(`{"username":"alice","password":"secret"}`)
	if resp := h.do("POST", "/auth/password", b, map[string]string{"Content-Type": "text/plain"}); resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("form-sendable content type: %d", resp.StatusCode)
	}
}

func TestPasswordLoginReplacesTemporaryPassword(t *testing.T) {
	h := newHarness(t)
	h.oidc.setupFor = "temp"
	h.oidc.currentPassword = "temp"
	h.kc.users["user-1"].RequiredActions = []string{"UPDATE_PASSWORD"}

	resp := h.passwordLogin(map[string]string{"username": "alice", "password": "temp"})
	if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != "password_change_required" {
		t.Fatal("expected the form to ask for a new password")
	}
	if resp := h.passwordLogin(map[string]string{"username": "alice", "password": "temp", "newPassword": "temp"}); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("same password: %d", resp.StatusCode)
	}

	// Keycloak stops reporting the required action once the password is replaced.
	resp = h.passwordLoginWithSwap("temp", "Better-123")
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("complete: %d", resp.StatusCode)
	}
	if h.kc.passwords["user-1"] != "Better-123" {
		t.Fatalf("password not stored: %v", h.kc.passwords)
	}
}

// passwordLoginWithSwap makes the fake accept newPassword as soon as Orbit has
// stored it through the Admin API, like Keycloak would.
func (h *harness) passwordLoginWithSwap(old, newPassword string) *http.Response {
	h.t.Helper()
	h.kc.onSetPassword = func(pw string) {
		h.oidc.mu.Lock()
		defer h.oidc.mu.Unlock()
		h.oidc.currentPassword = pw
	}
	return h.passwordLogin(map[string]string{"username": "alice", "password": old, "newPassword": newPassword})
}

func TestPasswordLoginFallsBackForOtherRequiredActions(t *testing.T) {
	h := newHarness(t)
	h.oidc.setupFor = "secret"
	h.kc.users["user-1"].RequiredActions = []string{"VERIFY_EMAIL"}
	resp := h.passwordLogin(map[string]string{"username": "alice", "password": "secret"})
	if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != "browser_required" {
		t.Fatal("expected a fallback to the sign-in page")
	}
}

func TestAccountPasswordChangeRechecksCurrentPassword(t *testing.T) {
	h := newHarness(t)
	h.login()
	if resp := h.write("POST", "/api/account/password", map[string]any{"currentPassword": "wrong", "newPassword": "Better-123"}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong current password: %d", resp.StatusCode)
	}
	if h.kc.passwords != nil {
		t.Fatal("password changed without verification")
	}
	var out map[string]int
	h.decode(h.write("POST", "/api/account/password", map[string]any{
		"currentPassword": "secret", "newPassword": "Better-123", "logoutOthers": true,
	}), http.StatusOK, &out)
	if h.kc.passwords["user-1"] != "Better-123" || out["endedSessions"] != 1 {
		t.Fatalf("passwords %v out %v", h.kc.passwords, out)
	}
	// The session opened just to check the password must not linger.
	if !slices.Contains(h.oidc.ended, "rt-pw") {
		t.Fatalf("verification session left open: %v", h.oidc.ended)
	}
	if !slices.Contains(h.store.AuditActions(), "account.password.change") {
		t.Fatal("not audited")
	}
}

func TestAccountEmailChangeResetsVerification(t *testing.T) {
	h := newHarness(t)
	h.login()
	h.kc.users["user-1"].EmailVerified = true
	if resp := h.write("POST", "/api/account/email", map[string]any{"currentPassword": "x", "email": "new@example.com"}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong password: %d", resp.StatusCode)
	}
	var out map[string]string
	h.decode(h.write("POST", "/api/account/email", map[string]any{"currentPassword": "secret", "email": "new@example.com"}), http.StatusOK, &out)
	u := h.kc.users["user-1"]
	if u.Email != "new@example.com" || u.EmailVerified || out["verification"] != "sent" {
		t.Fatalf("user %+v out %v", u, out)
	}
}

func TestTOTPEnrollment(t *testing.T) {
	h := newHarness(t)
	h.login()
	var setup struct {
		SetupToken string `json:"setupToken"`
		Secret     string `json:"secret"`
		QRImage    string `json:"qrImage"`
	}
	h.decode(h.write("POST", "/api/account/totp/setup", nil), http.StatusOK, &setup)
	if !strings.HasPrefix(setup.QRImage, "data:image/png;base64,") {
		t.Fatalf("qr: %.40s", setup.QRImage)
	}

	if resp := h.write("POST", "/api/account/totp", map[string]any{
		"setupToken": setup.SetupToken, "code": "000000", "currentPassword": "secret",
	}); resp.StatusCode != http.StatusUnprocessableEntity || errorCode(t, resp) != "invalid_code" {
		t.Fatal("wrong code accepted")
	}
	if len(h.oidc.logins) != 0 {
		t.Fatal("a mistyped code must not spend a password attempt")
	}

	// The token holds the raw secret; read it the way the handler does.
	plain, err := h.sealer.Open(setup.SetupToken, totpSetupAAD)
	if err != nil {
		t.Fatal(err)
	}
	var st totpSetup
	if err := json.Unmarshal(plain, &st); err != nil {
		t.Fatal(err)
	}
	code := totp.Code(st.Params, st.Secret, time.Now())
	if resp := h.write("POST", "/api/account/totp", map[string]any{
		"setupToken": setup.SetupToken, "code": code, "currentPassword": "wrong",
	}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong password: %d", resp.StatusCode)
	}
	h.decode(h.write("POST", "/api/account/totp", map[string]any{
		"setupToken": setup.SetupToken, "code": code, "currentPassword": "secret", "label": "Телефон",
	}), http.StatusNoContent, nil)
	if len(h.kc.otps) != 1 || h.kc.otps[0].Secret != st.Secret || h.kc.otps[0].Label != "Телефон" {
		t.Fatalf("otps: %+v", h.kc.otps)
	}
}

func TestTOTPSetupTokenIsBoundToUser(t *testing.T) {
	h := newHarness(t)
	b, _ := json.Marshal(totpSetup{Sub: "user-2", Secret: "x", Params: totp.Params{Digits: 6, Period: 30, Algorithm: "HmacSHA1"}, Expires: time.Now().Add(time.Hour)})
	h.login()
	resp := h.write("POST", "/api/account/totp", map[string]any{"setupToken": h.sealer.Seal(b, totpSetupAAD), "code": "1", "currentPassword": "secret"})
	if resp.StatusCode != http.StatusUnprocessableEntity || errorCode(t, resp) != "setup_expired" {
		t.Fatal("foreign setup token accepted")
	}
}

func TestDeleteCredentialChecksOwnershipAndType(t *testing.T) {
	h := newHarness(t)
	h.login()
	body := map[string]any{"currentPassword": "secret"}
	if resp := h.write("POST", "/api/account/credentials/someone-elses/delete", body); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("foreign credential: %d", resp.StatusCode)
	}
	if resp := h.write("POST", "/api/account/credentials/c-pw/delete", body); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("password: %d", resp.StatusCode)
	}
	if resp := h.write("POST", "/api/account/credentials/c-otp/delete", map[string]any{"currentPassword": "bad"}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("bad password: %d", resp.StatusCode)
	}
	h.decode(h.write("POST", "/api/account/credentials/c-otp/delete", body), http.StatusNoContent, nil)
	if !slices.Contains(h.kc.deleted, "c-otp") {
		t.Fatalf("deleted: %v", h.kc.deleted)
	}
}

func TestAccountLinkedAndEvents(t *testing.T) {
	h := newHarness(t)
	h.login()
	var linked struct{ Accounts []linkedAccount }
	h.decode(h.do("GET", "/api/account/linked", nil, nil), http.StatusOK, &linked)
	if len(linked.Accounts) != 2 || !linked.Accounts[0].Linked || linked.Accounts[0].UserName != "alice-gh" || linked.Accounts[1].Linked {
		t.Fatalf("linked: %+v", linked.Accounts)
	}
	resp := h.do("GET", "/api/account/events", nil, nil)
	var raw bytes.Buffer
	_, _ = raw.ReadFrom(resp.Body)
	if strings.Contains(raw.String(), "must-not-leak") || !strings.Contains(raw.String(), "LOGIN") {
		t.Fatalf("events: %s", raw.String())
	}
}

func TestKeycloakProxyRequiresAdmin(t *testing.T) {
	h := newHarness(t)
	h.login()
	if resp := h.do("GET", "/api/admin/keycloak", nil, nil); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin: %d", resp.StatusCode)
	}
	if len(h.kc.raw) != 0 {
		t.Fatalf("reached keycloak: %v", h.kc.raw)
	}
}

func TestKeycloakProxyStaysInsideTheRealm(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.login()
	for _, path := range []string{
		"/api/admin/keycloak/users/..%2F..%2F..%2Frealms",
		"/api/admin/keycloak/users/%2e%2e",
		"/api/admin/keycloak/users/a%5Cb",
		"/api/admin/keycloak/not-a-resource",
	} {
		if resp := h.do("GET", path, nil, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s: %d", path, resp.StatusCode)
		}
	}
	if len(h.kc.raw) != 0 {
		t.Fatalf("reached keycloak: %v", h.kc.raw)
	}
}

func TestKeycloakProxyForwardsAndAudits(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.login()
	h.decode(h.do("GET", "/api/admin/keycloak/roles?first=0&max=5", nil, nil), http.StatusOK, nil)
	h.decode(h.do("GET", "/api/admin/keycloak", nil, nil), http.StatusOK, nil)
	if !slices.Contains(h.kc.raw, "GET /admin/realms/orbit/roles?first=0&max=5") || !slices.Contains(h.kc.raw, "GET /admin/realms/orbit") {
		t.Fatalf("raw: %v", h.kc.raw)
	}
	if slices.Contains(h.store.AuditActions(), "admin.keycloak.get") {
		t.Fatal("reads must not be audited")
	}
	if resp := h.write("POST", "/api/admin/keycloak/roles", map[string]string{"name": "x"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("write: %d", resp.StatusCode)
	}
	if !slices.Contains(h.store.AuditActions(), "admin.keycloak.post") {
		t.Fatal("write not audited")
	}
	// Writes keep the session's CSRF protection.
	b := strings.NewReader(`{}`)
	if resp := h.do("POST", "/api/admin/keycloak/roles", b, map[string]string{"Origin": publicURL}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("no csrf: %d", resp.StatusCode)
	}
}

func TestKeycloakProxyTranslatesErrors(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.login()
	h.kc.rawStatus = map[string]*keycloak.RawResponse{
		"POST /admin/realms/orbit/roles": {Status: http.StatusConflict, Body: []byte(`{"errorMessage":"Role with name x already exists"}`)},
		"GET /admin/realms/orbit/keys":   {Status: http.StatusForbidden, Body: []byte(`{"error":"unknown_error"}`)},
	}
	var e apiError
	h.decode(h.write("POST", "/api/admin/keycloak/roles", map[string]string{"name": "x"}), http.StatusConflict, &e)
	if e.Message != "Role with name x already exists" {
		t.Fatalf("message: %q", e.Message)
	}
	h.decode(h.do("GET", "/api/admin/keycloak/keys", nil, nil), http.StatusBadGateway, &e)
	if e.Error != "keycloak_forbidden" {
		t.Fatalf("code: %q", e.Error)
	}
}

func TestKeycloakLockoutGuard(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.cfg.ClientID, h.cfg.AdminClientID = "orbit-web", "orbit-admin-api"
	h.login()
	h.kc.rawStatus = map[string]*keycloak.RawResponse{
		"GET /admin/realms/orbit/clients/web-uuid":   {Status: http.StatusOK, Body: []byte(`{"clientId":"orbit-web"}`)},
		"GET /admin/realms/orbit/clients/other-uuid": {Status: http.StatusOK, Body: []byte(`{"clientId":"wiki"}`)},
	}
	refused := []struct {
		method, path string
		body         any
	}{
		{"DELETE", "/api/admin/keycloak", nil},
		{"PUT", "/api/admin/keycloak", map[string]any{"enabled": false}},
		{"DELETE", "/api/admin/keycloak/roles/orbit-admin", nil},
		{"DELETE", "/api/admin/keycloak/clients/web-uuid", nil},
		{"POST", "/api/admin/keycloak/clients/web-uuid/client-secret", nil},
		{"PUT", "/api/admin/keycloak/clients/web-uuid", map[string]any{"directAccessGrantsEnabled": false}},
		{"DELETE", "/api/admin/keycloak/users/user-1", nil},
		{"PUT", "/api/admin/keycloak/users/user-1", map[string]any{"enabled": false}},
		{"DELETE", "/api/admin/keycloak/users/user-1/role-mappings/realm", []map[string]string{{"name": "orbit-admin"}}},
		{"DELETE", "/api/admin/keycloak/users/svc", nil},
		{"DELETE", "/api/admin/keycloak/users/svc/role-mappings/clients/x", []map[string]string{{"name": "realm-admin"}}},
	}
	for _, c := range refused {
		resp := h.write(c.method, c.path, c.body)
		if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != "lockout_guard" {
			t.Errorf("%s %s: %d", c.method, c.path, resp.StatusCode)
		}
	}
	allowed := []struct {
		method, path string
		body         any
	}{
		{"PUT", "/api/admin/keycloak", map[string]any{"displayName": "x"}},
		{"DELETE", "/api/admin/keycloak/roles/other", nil},
		{"DELETE", "/api/admin/keycloak/clients/other-uuid", nil},
		{"PUT", "/api/admin/keycloak/clients/web-uuid", map[string]any{"description": "x"}},
		{"DELETE", "/api/admin/keycloak/users/user-2", nil},
		{"DELETE", "/api/admin/keycloak/users/user-1/role-mappings/realm", []map[string]string{{"name": "developer"}}},
	}
	for _, c := range allowed {
		if resp := h.write(c.method, c.path, c.body); resp.StatusCode != http.StatusOK {
			t.Errorf("%s %s: %d", c.method, c.path, resp.StatusCode)
		}
	}
}
