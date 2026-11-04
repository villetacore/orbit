package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

var (
	scriptTag = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script\s*>`)
	srcAttr   = regexp.MustCompile(`(?i)\bsrc\s*=`)
)

// staticPage is an HTML page of the exported frontend.
type staticPage struct {
	body    []byte
	csp     string
	modTime time.Time
}

// pageCSP allows exactly the inline scripts of one page by their hashes. Next
// bootstraps each page with such scripts, and a static export cannot use nonces.
func pageCSP(html []byte) string {
	var sources strings.Builder
	for _, m := range scriptTag.FindAllSubmatch(html, -1) {
		if srcAttr.Match(m[1]) || len(m[2]) == 0 {
			continue
		}
		sum := sha256.Sum256(m[2])
		sources.WriteString(" 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'")
	}
	return strings.Replace(contentSecurityPolicy, "script-src 'self'", "script-src 'self'"+sources.String(), 1)
}

// loadStaticPages maps URL paths to the HTML files of a static export:
// index.html is "/", and keycloak/users.html is "/keycloak/users".
func loadStaticPages(dir string) (map[string]*staticPage, error) {
	pages := map[string]*staticPage{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || filepath.Ext(p) != ".html" {
			return nil
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		body, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		route := "/" + strings.TrimSuffix(filepath.ToSlash(rel), ".html")
		if route == "/index" {
			route = "/"
		}
		pages[route] = &staticPage{body: body, csp: pageCSP(body), modTime: info.ModTime()}
		return nil
	})
	return pages, err
}

// staticHandler serves the exported frontend. HTML is read once at startup,
// since the files of a deployed version do not change.
func staticHandler(dir string, log *slog.Logger) http.HandlerFunc {
	pages, err := loadStaticPages(dir)
	if err != nil {
		log.Error("read frontend", "dir", dir, "err", err)
	}
	files := http.FileServer(http.Dir(dir))

	return func(w http.ResponseWriter, r *http.Request) {
		route := path.Clean("/" + r.URL.Path)
		h := w.Header()
		h.Set("Cache-Control", "no-cache")

		if page, ok := pages[route]; ok {
			h.Set("Content-Security-Policy", page.csp)
			http.ServeContent(w, r, "page.html", page.modTime, bytes.NewReader(page.body))
			return
		}

		// HTML is only served by its route, which carries the matching policy.
		if path.Ext(route) != ".html" {
			if st, err := os.Stat(filepath.Join(dir, filepath.FromSlash(route))); err == nil && !st.IsDir() {
				if strings.HasPrefix(route, "/_next/static/") {
					h.Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}

		page, ok := pages["/404"]
		if !ok {
			http.NotFound(w, r)
			return
		}
		h.Set("Content-Security-Policy", page.csp)
		h.Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		if r.Method != http.MethodHead {
			w.Write(page.body) //nolint:errcheck
		}
	}
}
