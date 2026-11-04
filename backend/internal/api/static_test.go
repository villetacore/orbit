package api

import (
	"crypto/sha256"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeExport(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func scriptHash(script string) string {
	sum := sha256.Sum256([]byte(script))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}

func TestPageCSPAllowsOnlyInlineScriptsOfThePage(t *testing.T) {
	csp := pageCSP([]byte(`<head><script src="/_next/a.js" async></script><script>one()</script></head>
		<body><script>
two()</script><script src="/_next/b.js">ignored()</script></body>`))

	for _, want := range []string{scriptHash("one()"), scriptHash("\ntwo()")} {
		if !strings.Contains(csp, "script-src 'self' ") || !strings.Contains(csp, want) {
			t.Errorf("csp %q lacks %s", csp, want)
		}
	}
	if strings.Contains(csp, scriptHash("ignored()")) {
		t.Errorf("csp %q allows the body of an external script", csp)
	}
	if strings.Contains(csp, "unsafe-inline' 'sha") || strings.Contains(csp, "script-src 'unsafe-inline'") {
		t.Errorf("csp %q allows inline scripts in general", csp)
	}
}

func TestStaticHandler(t *testing.T) {
	dir := writeExport(t, map[string]string{
		"index.html":          `<script>home()</script>`,
		"services.html":       `<script>services()</script>`,
		"services.txt":        `flight data`,
		"keycloak/users.html": `<script>users()</script>`,
		"404.html":            `<script>missing()</script>`,
		"_next/static/a.js":   `chunk`,
		"favicon.svg":         `<svg/>`,
	})
	secret := filepath.Join(filepath.Dir(dir), "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	handler := staticHandler(dir, slog.New(slog.DiscardHandler))

	tests := []struct {
		name, path string
		status     int
		body       string
		script     string // an inline script the CSP must allow
		cache      string
	}{
		{name: "home", path: "/", status: 200, body: "home()", script: "home()", cache: "no-cache"},
		{name: "page", path: "/services", status: 200, body: "services()", script: "services()", cache: "no-cache"},
		{name: "page with a slash", path: "/services/", status: 200, body: "services()", script: "services()", cache: "no-cache"},
		{name: "nested page", path: "/keycloak/users", status: 200, body: "users()", script: "users()", cache: "no-cache"},
		{name: "route payload", path: "/services.txt", status: 200, body: "flight data", cache: "no-cache"},
		{name: "hashed asset", path: "/_next/static/a.js", status: 200, body: "chunk", cache: "public, max-age=31536000, immutable"},
		{name: "public file", path: "/favicon.svg", status: 200, body: "<svg/>", cache: "no-cache"},
		{name: "unknown path", path: "/nope", status: 404, body: "missing()", script: "missing()", cache: "no-cache"},
		{name: "missing asset", path: "/_next/static/gone.js", status: 404, body: "missing()", script: "missing()", cache: "no-cache"},
		{name: "html by file name", path: "/services.html", status: 404, body: "missing()", script: "missing()", cache: "no-cache"},
		{name: "directory", path: "/keycloak", status: 404, body: "missing()", script: "missing()", cache: "no-cache"},
		{name: "traversal", path: "/../secret.txt", status: 404, body: "missing()", script: "missing()", cache: "no-cache"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.URL.Path = tt.path
			handler(rec, req)

			body, _ := io.ReadAll(rec.Body)
			if rec.Code != tt.status || !strings.Contains(string(body), tt.body) {
				t.Errorf("got %d %q, want %d %q", rec.Code, body, tt.status, tt.body)
			}
			if got := rec.Header().Get("Cache-Control"); got != tt.cache {
				t.Errorf("Cache-Control = %q, want %q", got, tt.cache)
			}
			if tt.script != "" && !strings.Contains(rec.Header().Get("Content-Security-Policy"), scriptHash(tt.script)) {
				t.Errorf("CSP %q does not allow %s", rec.Header().Get("Content-Security-Policy"), tt.script)
			}
		})
	}
}
