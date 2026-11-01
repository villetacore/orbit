package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/villetacore/orbit/backend/internal/auth"
)

const (
	sessionCookie = "orbit_session"
	authCookie    = "orbit_auth"
	csrfHeader    = "X-CSRF-Token"

	// Refresh the IdP tokens slightly before they expire.
	refreshMargin = 30 * time.Second
)

type ctxKey int

const sessionKey ctxKey = iota

func sessionFrom(ctx context.Context) *auth.Session {
	s, _ := ctx.Value(sessionKey).(*auth.Session)
	return s
}

// currentSession loads the session from the cookie and refreshes tokens when
// they are about to expire. A refresh rejected by Keycloak (session revoked,
// user disabled) ends the Orbit session too.
func (s *Server) currentSession(r *http.Request) (*auth.Session, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, auth.ErrNoSession
	}
	ctx := r.Context()
	sess, err := s.sessions.Get(ctx, c.Value)
	if err != nil {
		return nil, err
	}
	if time.Until(sess.Tokens.Expiry) > refreshMargin {
		return sess, nil
	}
	claims, tokens, err := s.oidc.Refresh(ctx, sess.Tokens.RefreshToken)
	if errors.Is(err, auth.ErrRefreshRejected) {
		_ = s.sessions.Delete(ctx, sess.ID)
		return nil, auth.ErrNoSession
	}
	if err != nil {
		return nil, err
	}
	if claims.Subject != sess.Claims.Subject {
		_ = s.sessions.Delete(ctx, sess.ID)
		return nil, auth.ErrNoSession
	}
	sess.Claims, sess.Tokens = claims, tokens
	if err := s.sessions.Save(ctx, sess); err != nil {
		return nil, err
	}
	return sess, nil
}

func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, err := s.currentSession(r)
		if errors.Is(err, auth.ErrNoSession) {
			s.clearCookie(w, sessionCookie, "/")
			writeError(w, http.StatusUnauthorized, "unauthorized", "Требуется вход")
			return
		}
		if err != nil {
			s.log.Error("load session", "err", err)
			writeError(w, http.StatusServiceUnavailable, "unavailable", "Сервис идентификации недоступен")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionKey, sess)))
	})
}

func isSafeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// requireCSRF protects state-changing requests: the per-session token (handed
// to the SPA by /api/me) must be echoed in a header, and a present Origin
// header must match Orbit's own origin.
func (s *Server) requireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSafeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		if o := r.Header.Get("Origin"); o != "" && o != s.cfg.PublicURL {
			writeError(w, http.StatusForbidden, "bad_origin", "Запрос с недопустимого источника")
			return
		}
		sess := sessionFrom(r.Context())
		token := r.Header.Get(csrfHeader)
		if sess == nil || token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(sess.CSRFToken)) != 1 {
			writeError(w, http.StatusForbidden, "csrf", "Неверный CSRF-токен")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sess := sessionFrom(r.Context()); sess == nil || !sess.Claims.HasRole(s.cfg.AdminRole) {
			writeError(w, http.StatusForbidden, "forbidden", "Недостаточно прав")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) limitWrites(next http.Handler) http.Handler {
	limited := s.rateLimit(s.writeLimiter)(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSafeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		limited.ServeHTTP(w, r)
	})
}

func (s *Server) rateLimit(l *limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.allow(clientIP(r)) {
				w.Header().Set("Retry-After", strconv.Itoa(60))
				writeError(w, http.StatusTooManyRequests, "rate_limited", "Слишком много запросов, попробуйте позже")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// limiter is a per-client token bucket. Entries idle for 10 minutes are evicted.
type limiter struct {
	mu        sync.Mutex
	limit     rate.Limit
	burst     int
	clients   map[string]*limiterEntry
	lastSweep time.Time
}

type limiterEntry struct {
	l    *rate.Limiter
	seen time.Time
}

func newLimiter(perMinute, burst int) *limiter {
	return &limiter{
		limit:   rate.Limit(float64(perMinute) / 60),
		burst:   burst,
		clients: map[string]*limiterEntry{},
	}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.lastSweep) > time.Minute {
		for k, e := range l.clients {
			if now.Sub(e.seen) > 10*time.Minute {
				delete(l.clients, k)
			}
		}
		l.lastSweep = now
	}
	e, ok := l.clients[key]
	if !ok {
		e = &limiterEntry{l: rate.NewLimiter(l.limit, l.burst)}
		l.clients[key] = e
	}
	e.seen = now
	return e.l.Allow()
}

// clientIP uses RemoteAddr; middleware.RealIP rewrites it from proxy headers
// when ORBIT_TRUST_PROXY is enabled.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) setCookie(w http.ResponseWriter, name, value, path string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearCookie(w http.ResponseWriter, name, path string) {
	s.setCookie(w, name, "", path, -1)
}

type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, apiError{Error: code, Message: msg})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Некорректный JSON: "+err.Error())
		return false
	}
	return true
}
