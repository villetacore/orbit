package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/villetacore/orbit/backend/internal/auth"
	"github.com/villetacore/orbit/backend/internal/avatar"
	"github.com/villetacore/orbit/backend/internal/config"
	"github.com/villetacore/orbit/backend/internal/keycloak"
	"github.com/villetacore/orbit/backend/internal/seal"
	"github.com/villetacore/orbit/backend/internal/store"
)

// fakeOIDC emulates Keycloak's authorization endpoint: AuthCodeURL records the
// request and the test "returns" from the IdP by calling /auth/callback.
type fakeOIDC struct {
	mu            sync.Mutex
	claims        auth.Claims
	nonce         string
	lastExtra     map[string]string
	expiry        time.Time
	refreshExpiry time.Time
	refreshErr    error
	refreshCalled int
}

func (f *fakeOIDC) AuthCodeURL(state, nonce, _ string, extra map[string]string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nonce = nonce
	f.lastExtra = extra
	return "https://idp.test/auth?state=" + url.QueryEscape(state)
}

func (f *fakeOIDC) Exchange(_ context.Context, code, _, nonce string) (auth.Claims, auth.Tokens, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if code != "good-code" || nonce != f.nonce {
		return auth.Claims{}, auth.Tokens{}, errors.New("bad code")
	}
	return f.claims, auth.Tokens{AccessToken: "at", RefreshToken: "rt", IDToken: "idt", Expiry: f.expiry}, nil
}

func (f *fakeOIDC) Refresh(_ context.Context, _ string) (auth.Claims, auth.Tokens, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refreshCalled++
	if f.refreshErr != nil {
		return auth.Claims{}, auth.Tokens{}, f.refreshErr
	}
	exp := f.refreshExpiry
	if exp.IsZero() {
		exp = time.Now().Add(time.Hour)
	}
	return f.claims, auth.Tokens{AccessToken: "at2", RefreshToken: "rt2", IDToken: "idt2", Expiry: exp}, nil
}

func (f *fakeOIDC) LogoutURL(idToken, redirect string) string {
	return "https://idp.test/logout?id_token_hint=" + idToken + "&post_logout_redirect_uri=" + url.QueryEscape(redirect)
}

type fakeKeycloak struct {
	mu    sync.Mutex
	users map[string]*keycloak.User
}

func (k *fakeKeycloak) GetUser(_ context.Context, id string) (*keycloak.User, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	u, ok := k.users[id]
	if !ok {
		return nil, keycloak.ErrNotFound
	}
	cp := *u
	cp.Attributes = map[string][]string{}
	for key, v := range u.Attributes {
		cp.Attributes[key] = slices.Clone(v)
	}
	return &cp, nil
}

func (k *fakeKeycloak) UpdateUser(_ context.Context, u *keycloak.User) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	cp := *u
	k.users[u.ID] = &cp
	return nil
}

func (k *fakeKeycloak) UserGroups(context.Context, string) ([]keycloak.Group, error) {
	return []keycloak.Group{{ID: "g1", Name: "Engineering", Path: "/Engineering"}}, nil
}

const publicURL = "http://orbit.test"

type harness struct {
	t      *testing.T
	srv    *httptest.Server
	client *http.Client
	oidc   *fakeOIDC
	kc     *fakeKeycloak
	store  *store.Memory
	files  *avatar.Memory
	csrf   string
}

func newHarness(t *testing.T, roles ...string) *harness {
	t.Helper()
	cfg := &config.Config{
		PublicURL:          publicURL,
		KeycloakURL:        "https://idp.test",
		Realm:              "orbit",
		AdminRole:          "orbit-admin",
		EditableAttributes: []string{"phoneNumber"},
		VisibleAttributes:  []string{"department"},
		AvatarMaxBytes:     2 << 20,
	}
	sealer, err := seal.New(strings.Repeat("k", 32))
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{
		t: t,
		oidc: &fakeOIDC{
			claims: auth.Claims{Subject: "user-1", PreferredUsername: "alice", Email: "alice@example.com", Roles: roles},
			expiry: time.Now().Add(time.Hour),
		},
		kc: &fakeKeycloak{users: map[string]*keycloak.User{
			"user-1": {ID: "user-1", Username: "alice", Email: "alice@example.com", FirstName: "Alice", LastName: "A",
				Enabled: true, Attributes: map[string][]string{"department": {"R&D"}}},
		}},
		store: store.NewMemory(),
		files: avatar.NewMemory(),
	}
	handler := New(Deps{
		Config:   cfg,
		OIDC:     h.oidc,
		Sessions: auth.NewManager(auth.NewMemoryRepo(), sealer, time.Hour),
		Sealer:   sealer,
		Keycloak: h.kc,
		Store:    h.store,
		Avatars:  h.files,
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	h.srv = httptest.NewServer(handler)
	t.Cleanup(h.srv.Close)
	jar, _ := cookiejar.New(nil)
	h.client = &http.Client{
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return h
}

func (h *harness) login() {
	h.t.Helper()
	resp := h.do("GET", "/auth/login?return_to=/services", nil, nil)
	if resp.StatusCode != http.StatusFound {
		h.t.Fatalf("login: status %d", resp.StatusCode)
	}
	loc, _ := url.Parse(resp.Header.Get("Location"))
	state := loc.Query().Get("state")
	resp = h.do("GET", "/auth/callback?code=good-code&state="+url.QueryEscape(state), nil, nil)
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/services" {
		h.t.Fatalf("callback: status %d location %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	var me meResponse
	h.decode(h.do("GET", "/api/me", nil, nil), http.StatusOK, &me)
	h.csrf = me.CSRFToken
}

func (h *harness) do(method, path string, body io.Reader, hdr map[string]string) *http.Response {
	h.t.Helper()
	req, err := http.NewRequest(method, h.srv.URL+path, body)
	if err != nil {
		h.t.Fatal(err)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	h.t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// write sends a state-changing JSON request with the CSRF token.
func (h *harness) write(method, path string, v any) *http.Response {
	h.t.Helper()
	b, _ := json.Marshal(v)
	return h.do(method, path, bytes.NewReader(b), map[string]string{
		"Content-Type": "application/json", csrfHeader: h.csrf, "Origin": publicURL,
	})
}

func (h *harness) decode(resp *http.Response, want int, v any) {
	h.t.Helper()
	if resp.StatusCode != want {
		b, _ := io.ReadAll(resp.Body)
		h.t.Fatalf("%s %s: status %d, want %d: %s", resp.Request.Method, resp.Request.URL.Path, resp.StatusCode, want, b)
	}
	if v != nil {
		if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
			h.t.Fatal(err)
		}
	}
}

func TestLoginFlow(t *testing.T) {
	h := newHarness(t)
	if resp := h.do("GET", "/api/me", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous /api/me: %d", resp.StatusCode)
	}
	h.login()
	if h.csrf == "" {
		t.Fatal("no csrf token in /api/me")
	}
	if !slices.Contains(h.store.AuditActions(), "auth.login") {
		t.Fatal("login not audited")
	}

	var out map[string]string
	h.decode(h.write("POST", "/auth/logout", nil), http.StatusOK, &out)
	if !strings.Contains(out["redirectUrl"], "id_token_hint=idt") {
		t.Fatalf("logout url: %q", out["redirectUrl"])
	}
	if resp := h.do("GET", "/api/me", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("after logout: %d", resp.StatusCode)
	}
}

func TestCallbackRejectsBadState(t *testing.T) {
	h := newHarness(t)
	h.do("GET", "/auth/login", nil, nil)
	resp := h.do("GET", "/auth/callback?code=good-code&state=forged", nil, nil)
	if resp.Header.Get("Location") != "/?error=login_failed" {
		t.Fatalf("location %q", resp.Header.Get("Location"))
	}
	if resp := h.do("GET", "/api/me", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("session created despite bad state: %d", resp.StatusCode)
	}
}

func TestSecurityActionPassesKcAction(t *testing.T) {
	h := newHarness(t)
	resp := h.do("GET", "/auth/action/UPDATE_PASSWORD", nil, nil)
	if resp.StatusCode != http.StatusFound || h.oidc.lastExtra["kc_action"] != "UPDATE_PASSWORD" {
		t.Fatalf("status %d extra %v", resp.StatusCode, h.oidc.lastExtra)
	}
	if resp := h.do("GET", "/auth/action/delete_account", nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown action: %d", resp.StatusCode)
	}
}

func TestCSRFProtection(t *testing.T) {
	h := newHarness(t)
	h.login()
	body := `{"firstName":"Eve"}`
	resp := h.do("PATCH", "/api/profile", strings.NewReader(body), map[string]string{"Content-Type": "application/json"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("missing token: %d", resp.StatusCode)
	}
	resp = h.do("PATCH", "/api/profile", strings.NewReader(body), map[string]string{
		csrfHeader: h.csrf, "Origin": "https://evil.test",
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", resp.StatusCode)
	}
	if h.kc.users["user-1"].FirstName != "Alice" {
		t.Fatal("profile changed without CSRF token")
	}
}

func TestProfileUpdate(t *testing.T) {
	h := newHarness(t)
	h.login()

	var p profileView
	h.decode(h.write("PATCH", "/api/profile", map[string]any{
		"firstName": "  Алиса ", "attributes": map[string]string{"phoneNumber": "+7 900 000-00-00"},
	}), http.StatusOK, &p)
	if p.FirstName != "Алиса" {
		t.Fatalf("firstName %q", p.FirstName)
	}
	u := h.kc.users["user-1"]
	if u.Attr("phoneNumber") != "+7 900 000-00-00" || u.Attr("department") != "R&D" {
		t.Fatalf("attributes %v", u.Attributes)
	}

	// Attributes that are only visible (or unknown) must not be writable.
	for _, attr := range []string{"department", "picture", "isAdmin"} {
		resp := h.write("PATCH", "/api/profile", map[string]any{"attributes": map[string]string{attr: "x"}})
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("%s: status %d", attr, resp.StatusCode)
		}
	}
	// Email and username are not part of the update contract at all.
	if resp := h.write("PATCH", "/api/profile", map[string]any{"email": "x@evil.test"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("email update: %d", resp.StatusCode)
	}
	if resp := h.write("PATCH", "/api/profile", map[string]any{"lastName": ""}); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("empty lastName: %d", resp.StatusCode)
	}
	if u := h.kc.users["user-1"]; u.Attr("department") != "R&D" || u.Email != "alice@example.com" {
		t.Fatalf("protected fields changed: %+v", u)
	}
	if !slices.Contains(h.store.AuditActions(), "profile.update") {
		t.Fatal("profile update not audited")
	}
}

func pngBytes(t *testing.T, w, hgt int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, hgt))
	for x := range w {
		img.Set(x, x%hgt, color.RGBA{R: 200, A: 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func (h *harness) upload(data []byte) *http.Response {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "a.png")
	fw.Write(data)
	mw.Close()
	return h.do("PUT", "/api/profile/avatar", &body, map[string]string{
		"Content-Type": mw.FormDataContentType(), csrfHeader: h.csrf, "Origin": publicURL,
	})
}

func TestAvatarLifecycle(t *testing.T) {
	h := newHarness(t)
	h.login()

	var out map[string]string
	h.decode(h.upload(pngBytes(t, 800, 600)), http.StatusOK, &out)
	resp := h.do("GET", out["avatarUrl"], nil, nil)
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("get avatar: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	img, err := png.Decode(resp.Body)
	if err != nil || img.Bounds().Dx() != 512 || img.Bounds().Dy() != 512 {
		t.Fatalf("served avatar not normalized: %v %v", err, img)
	}
	if got := h.kc.users["user-1"].Attr("picture"); got != publicURL+out["avatarUrl"] {
		t.Fatalf("picture attribute %q", got)
	}

	// Replacing removes the old object.
	h.decode(h.upload(pngBytes(t, 300, 300)), http.StatusOK, nil)
	if n := len(h.files.Objects); n != 1 {
		t.Fatalf("objects after replace: %d", n)
	}

	if resp := h.upload([]byte("<svg onload=alert(1)>")); resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("svg upload: %d", resp.StatusCode)
	}

	resp = h.do("DELETE", "/api/profile/avatar", nil, map[string]string{csrfHeader: h.csrf})
	if resp.StatusCode != http.StatusNoContent || len(h.files.Objects) != 0 || h.kc.users["user-1"].Attr("picture") != "" {
		t.Fatalf("delete: %d objects=%d", resp.StatusCode, len(h.files.Objects))
	}
}

func (h *harness) seedServices() (public, restricted, hidden *store.Service) {
	ctx := context.Background()
	public, _ = h.store.CreateService(ctx, store.ServiceInput{Slug: "wiki", Name: "Wiki", URL: "https://wiki.test", Status: store.StatusActive})
	restricted, _ = h.store.CreateService(ctx, store.ServiceInput{Slug: "git", Name: "Git", URL: "https://git.test",
		Status: store.StatusActive, RequiredRoles: []string{"developer"}})
	hidden, _ = h.store.CreateService(ctx, store.ServiceInput{Slug: "old", Name: "Old", URL: "https://old.test", Status: store.StatusHidden})
	return
}

func TestCatalogVisibility(t *testing.T) {
	h := newHarness(t, "employee")
	_, restricted, _ := h.seedServices()
	h.login()

	var resp servicesResponse
	h.decode(h.do("GET", "/api/services", nil, nil), http.StatusOK, &resp)
	if len(resp.Services) != 1 || resp.Services[0].Slug != "wiki" {
		t.Fatalf("visible services: %+v", resp.Services)
	}

	if r := h.write("PUT", "/api/services/"+restricted.ID+"/favorite", map[string]bool{"favorite": true}); r.StatusCode != http.StatusNotFound {
		t.Fatalf("favorite restricted: %d", r.StatusCode)
	}
	if r := h.do("GET", "/go/git", nil, nil); !strings.HasPrefix(r.Header.Get("Location"), "/services?unavailable=") {
		t.Fatalf("launch restricted: %q", r.Header.Get("Location"))
	}
	if r := h.do("GET", "/go/old", nil, nil); !strings.HasPrefix(r.Header.Get("Location"), "/services?unavailable=") {
		t.Fatalf("launch hidden: %q", r.Header.Get("Location"))
	}
	if r := h.do("GET", "/go/wiki", nil, nil); r.Header.Get("Location") != "https://wiki.test" {
		t.Fatalf("launch wiki: %q", r.Header.Get("Location"))
	}
	if !slices.Contains(h.store.AuditActions(), "service.launch") {
		t.Fatal("launch not audited")
	}
}

func TestCatalogWithRoleAndFavorites(t *testing.T) {
	h := newHarness(t, "developer")
	_, restricted, _ := h.seedServices()
	h.login()

	h.decode(h.write("PUT", "/api/services/"+restricted.ID+"/favorite", map[string]bool{"favorite": true}), http.StatusNoContent, nil)
	var resp servicesResponse
	h.decode(h.do("GET", "/api/services", nil, nil), http.StatusOK, &resp)
	if len(resp.Services) != 2 {
		t.Fatalf("services: %+v", resp.Services)
	}
	for _, s := range resp.Services {
		if s.Favorite != (s.Slug == "git") {
			t.Fatalf("favorite flag wrong for %s", s.Slug)
		}
	}
}

func TestLaunchRequiresLogin(t *testing.T) {
	h := newHarness(t)
	h.seedServices()
	r := h.do("GET", "/go/wiki", nil, nil)
	if r.Header.Get("Location") != "/auth/login?return_to=%2Fgo%2Fwiki" {
		t.Fatalf("location %q", r.Header.Get("Location"))
	}
}

func TestAdminRequiresRole(t *testing.T) {
	h := newHarness(t, "employee")
	h.login()
	if r := h.do("GET", "/api/admin/services", nil, nil); r.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin list: %d", r.StatusCode)
	}
	if r := h.write("POST", "/api/admin/services", map[string]any{"slug": "x1", "name": "X", "url": "https://x.test"}); r.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin create: %d", r.StatusCode)
	}
}

func TestAdminServiceCRUD(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.login()

	bad := map[string]any{"slug": "evil", "name": "Evil", "url": "javascript:alert(1)"}
	if r := h.write("POST", "/api/admin/services", bad); r.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("javascript url accepted: %d", r.StatusCode)
	}

	in := map[string]any{"slug": "crm", "name": "CRM", "url": "https://crm.test", "category": "Продажи", "requiredRoles": []string{"sales", " sales "}}
	var svc store.Service
	h.decode(h.write("POST", "/api/admin/services", in), http.StatusCreated, &svc)
	if len(svc.RequiredRoles) != 1 || svc.Status != store.StatusActive {
		t.Fatalf("normalized service: %+v", svc)
	}
	if r := h.write("POST", "/api/admin/services", in); r.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate slug: %d", r.StatusCode)
	}
	in["status"] = "hidden"
	h.decode(h.write("PUT", "/api/admin/services/"+svc.ID, in), http.StatusOK, &svc)
	if svc.Status != store.StatusHidden {
		t.Fatalf("status %q", svc.Status)
	}
	h.decode(h.write("DELETE", "/api/admin/services/"+svc.ID, nil), http.StatusNoContent, nil)

	var audit struct{ Events []store.AuditEvent }
	h.decode(h.do("GET", "/api/admin/audit", nil, nil), http.StatusOK, &audit)
	var actions []string
	for _, e := range audit.Events {
		actions = append(actions, e.Action)
	}
	for _, want := range []string{"admin.service.create", "admin.service.update", "admin.service.delete"} {
		if !slices.Contains(actions, want) {
			t.Fatalf("audit missing %s: %v", want, actions)
		}
	}
}

func TestRefreshRejectedEndsSession(t *testing.T) {
	h := newHarness(t)
	h.oidc.expiry = time.Now()        // stored tokens are already due for refresh
	h.oidc.refreshExpiry = time.Now() // and stay due after each refresh
	h.login()                         // /api/me refreshes successfully
	if h.oidc.refreshCalled == 0 {
		t.Fatal("refresh not attempted")
	}
	h.oidc.mu.Lock()
	h.oidc.refreshErr = auth.ErrRefreshRejected
	h.oidc.mu.Unlock()
	if r := h.do("GET", "/api/profile", nil, nil); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked session still valid: %d", r.StatusCode)
	}
	h.oidc.mu.Lock()
	h.oidc.refreshErr = nil
	h.oidc.mu.Unlock()
	if r := h.do("GET", "/api/profile", nil, nil); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("session resurrected after rejection: %d", r.StatusCode)
	}
}

func TestSafeReturnTo(t *testing.T) {
	cases := map[string]string{
		"":                       "/",
		"/services?q=1":          "/services?q=1",
		"//evil.test":            "/",
		"/\\evil.test":           "/",
		"https://evil.test/":     "/",
		"services":               "/",
		"/auth/login":            "/",
		"/profile\r\nSet-Cookie": "/",
	}
	for in, want := range cases {
		if got := safeReturnTo(in); got != want {
			t.Errorf("safeReturnTo(%q) = %q, want %q", in, got, want)
		}
	}
}

func (h *harness) uploadTo(path string, data []byte) *http.Response {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "f.png")
	fw.Write(data)
	mw.Close()
	return h.do("PUT", path, &body, map[string]string{
		"Content-Type": mw.FormDataContentType(), csrfHeader: h.csrf, "Origin": publicURL,
	})
}

func TestBrandingPublicDefaults(t *testing.T) {
	h := newHarness(t)
	var v brandingView
	h.decode(h.do("GET", "/api/branding", nil, nil), http.StatusOK, &v)
	if v.AppName != "Orbit" || v.PrimaryColor != "#8B7CF6" || v.AccentColor != "#B8EF65" || v.FaviconURL != "" {
		t.Fatalf("defaults: %+v", v)
	}
}

func TestBrandingRequiresAdmin(t *testing.T) {
	h := newHarness(t, "employee")
	h.login()
	in := map[string]string{"appName": "X", "primaryColor": "#000000", "accentColor": "#FFFFFF"}
	if r := h.write("PUT", "/api/admin/branding", in); r.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin update: %d", r.StatusCode)
	}
	if r := h.uploadTo("/api/admin/branding/favicon", pngBytes(t, 64, 64)); r.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin upload: %d", r.StatusCode)
	}
}

func TestBrandingUpdateAndAssets(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.login()

	bad := map[string]string{"appName": "", "primaryColor": "red", "accentColor": "#12345", "supportUrl": "javascript:alert(1)", "supportEmail": "Eve <e@x.test>"}
	resp := h.write("PUT", "/api/admin/branding", bad)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("invalid branding accepted: %d", resp.StatusCode)
	}
	var e apiError
	json.NewDecoder(resp.Body).Decode(&e)
	for _, f := range []string{"appName", "primaryColor", "accentColor", "supportUrl", "supportEmail"} {
		if !strings.Contains(e.Message, f) {
			t.Errorf("no error for %s: %q", f, e.Message)
		}
	}

	good := map[string]string{"appName": " Velessoft ID ", "primaryColor": "#8b7cf6", "accentColor": "#B8EF65",
		"landingTitle": "Вход", "supportEmail": "help@example.com", "supportUrl": "https://help.example.com"}
	var v brandingView
	h.decode(h.write("PUT", "/api/admin/branding", good), http.StatusOK, &v)
	if v.AppName != "Velessoft ID" || v.PrimaryColor != "#8B7CF6" {
		t.Fatalf("normalized: %+v", v)
	}

	h.decode(h.uploadTo("/api/admin/branding/favicon", pngBytes(t, 600, 400)), http.StatusOK, &v)
	if v.FaviconURL == "" || v.AppName != "Velessoft ID" {
		t.Fatalf("after upload: %+v", v)
	}
	r := h.do("GET", v.FaviconURL, nil, nil)
	img, err := png.Decode(r.Body)
	if r.StatusCode != http.StatusOK || err != nil || img.Bounds().Dx() != 256 || img.Bounds().Dy() != 256 {
		t.Fatalf("favicon: %d %v", r.StatusCode, err)
	}
	if r := h.uploadTo("/api/admin/branding/logo", []byte("<svg/>")); r.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("svg logo: %d", r.StatusCode)
	}
	if r := h.uploadTo("/api/admin/branding/script", pngBytes(t, 64, 64)); r.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown asset: %d", r.StatusCode)
	}

	h.decode(h.write("DELETE", "/api/admin/branding/favicon", nil), http.StatusOK, &v)
	if v.FaviconURL != "" || len(h.files.Objects) != 0 {
		t.Fatalf("after delete: %+v objects=%d", v, len(h.files.Objects))
	}
	if !slices.Contains(h.store.AuditActions(), "admin.branding.update") {
		t.Fatal("branding update not audited")
	}
}

func TestReadyz(t *testing.T) {
	h := newHarness(t)
	if r := h.do("GET", "/readyz", nil, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("readyz: %d", r.StatusCode)
	}
}
