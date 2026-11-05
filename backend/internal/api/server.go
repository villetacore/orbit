// Package api is Orbit's HTTP layer: the OIDC backend-for-frontend endpoints
// under /auth, the JSON API under /api and SSO launch links under /go.
package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/villetacore/orbit/backend/internal/auth"
	"github.com/villetacore/orbit/backend/internal/avatar"
	"github.com/villetacore/orbit/backend/internal/config"
	"github.com/villetacore/orbit/backend/internal/keycloak"
	"github.com/villetacore/orbit/backend/internal/seal"
	"github.com/villetacore/orbit/backend/internal/store"
)

// OIDC is the identity provider client (implemented by auth.Provider).
type OIDC interface {
	AuthCodeURL(state, nonce, verifier string, extra map[string]string) string
	Exchange(ctx context.Context, code, verifier, nonce string) (auth.Claims, auth.Tokens, error)
	Refresh(ctx context.Context, refreshToken string) (auth.Claims, auth.Tokens, error)
	Login(ctx context.Context, in auth.PasswordLogin) (auth.Claims, auth.Tokens, error)
	EndSession(ctx context.Context, refreshToken string) error
}

// Keycloak is the Admin REST API subset Orbit uses (implemented by keycloak.Admin).
type Keycloak interface {
	GetUser(ctx context.Context, id string) (*keycloak.User, error)
	UpdateUser(ctx context.Context, u *keycloak.User) error
	UserGroups(ctx context.Context, id string) ([]keycloak.Group, error)
	ListUsers(ctx context.Context, search string, first, max int) ([]keycloak.User, error)
	UserRealmRoles(ctx context.Context, id string) ([]keycloak.Role, error)
	UserSessions(ctx context.Context, id string) ([]keycloak.Session, error)
	DeleteSession(ctx context.Context, sessionID string) error
	LogoutUser(ctx context.Context, id string) error
	UserCredentials(ctx context.Context, id string) ([]keycloak.Credential, error)
	ExecuteActionsEmail(ctx context.Context, id string, actions []string) error
	CreateUser(ctx context.Context, u *keycloak.User) (string, error)
	SetPassword(ctx context.Context, id, password string, temporary bool) error
	FindUserByLogin(ctx context.Context, login string) (*keycloak.User, error)
	AddOTPCredential(ctx context.Context, id string, c keycloak.OTPCredential) error
	DeleteCredential(ctx context.Context, id, credentialID string) error
	SetCredentialLabel(ctx context.Context, id, credentialID, label string) error
	GetRealm(ctx context.Context) (*keycloak.RealmSettings, error)
	UserConsents(ctx context.Context, id string) ([]keycloak.Consent, error)
	DeleteConsent(ctx context.Context, id, clientID string) error
	FederatedIdentities(ctx context.Context, id string) ([]keycloak.FederatedIdentity, error)
	DeleteFederatedIdentity(ctx context.Context, id, provider string) error
	IdentityProviders(ctx context.Context) ([]keycloak.IdentityProvider, error)
	UserEvents(ctx context.Context, id string, limit int) ([]keycloak.Event, error)
	SendVerifyEmail(ctx context.Context, id string) error
	Raw(ctx context.Context, method, path string, body []byte, contentType string) (*keycloak.RawResponse, error)
	RealmPath() string
}

type Deps struct {
	Config   *config.Config
	Version  string // shown to signed-in users
	OIDC     OIDC
	Sessions *auth.Manager
	Sealer   *seal.Sealer
	Keycloak Keycloak
	Store    store.Store
	Avatars  avatar.Storage
	Logger   *slog.Logger
	// Ready reports whether dependencies (the database) are reachable; nil
	// means always ready.
	Ready func(ctx context.Context) error
}

type Server struct {
	cfg      *config.Config
	version  string
	oidc     OIDC
	sessions *auth.Manager
	sealer   *seal.Sealer
	kc       Keycloak
	store    store.Store
	avatars  avatar.Storage
	log      *slog.Logger
	ready    func(ctx context.Context) error

	authLimiter     *limiter
	uploadLimiter   *limiter
	writeLimiter    *limiter
	registerLimiter *limiter
	loginLimiter    *limiter
}

func New(d Deps) http.Handler {
	s := &Server{
		cfg:      d.Config,
		version:  d.Version,
		oidc:     d.OIDC,
		sessions: d.Sessions,
		sealer:   d.Sealer,
		kc:       d.Keycloak,
		store:    d.Store,
		avatars:  d.Avatars,
		log:      d.Logger,
		ready:    d.Ready,

		authLimiter:   newLimiter(30, 10),
		uploadLimiter: newLimiter(10, 3),
		writeLimiter:  newLimiter(120, 30),
		// Sign-up requests are public: ten per IP and minute, with room to fix typos.
		registerLimiter: newLimiter(10, 10),
		// Passwords are checked here: Keycloak's brute-force detection guards
		// each account, this guards against spraying many accounts from one IP.
		loginLimiter: newLimiter(20, 10),
	}
	if s.log == nil {
		s.log = slog.Default()
	}
	return s.routes()
}

func (s *Server) routes() http.Handler {
	r := chi.NewRouter()
	if s.cfg.TrustProxy {
		r.Use(middleware.RealIP)
	}
	r.Use(middleware.RequestID, s.requestLogger, middleware.Recoverer, s.securityHeaders)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) }) //nolint:errcheck
	r.Get("/readyz", s.handleReady)

	r.Route("/auth", func(r chi.Router) {
		r.Use(s.rateLimit(s.authLimiter))
		r.Get("/login", s.handleLogin)
		r.With(s.rateLimit(s.loginLimiter)).Post("/password", s.handlePasswordLogin)
		r.Get("/action/{action}", s.handleAction)
		r.Get("/callback", s.handleCallback)
		r.With(s.requireSession, s.requireCSRF).Post("/logout", s.handleLogout)
	})

	r.Get("/go/{ref}", s.handleLaunch)

	r.Route("/api", func(r chi.Router) {
		r.Use(noStore)
		r.Get("/config", s.handleConfig)
		r.Get("/users/{sub}/avatar", s.handleGetAvatar)
		r.Get("/branding", s.handleBranding)
		r.Get("/branding/{asset}", s.handleBrandingAsset)
		r.With(s.rateLimit(s.registerLimiter)).Post("/register", s.handleRegister)

		r.Group(func(r chi.Router) {
			r.Use(s.requireSession, s.requireCSRF, s.limitWrites)
			r.Get("/me", s.handleMe)
			r.Get("/profile", s.handleGetProfile)
			r.Patch("/profile", s.handleUpdateProfile)
			r.With(s.rateLimit(s.uploadLimiter)).Put("/profile/avatar", s.handleUploadAvatar)
			r.Delete("/profile/avatar", s.handleDeleteAvatar)
			r.Get("/services", s.handleListServices)
			r.Put("/services/{id}/favorite", s.handleSetFavorite)
			r.Get("/account/sessions", s.handleAccountSessions)
			r.Delete("/account/sessions/{id}", s.handleAccountEndSession)
			r.Post("/account/sessions/end-others", s.handleAccountEndOtherSessions)
			r.Get("/account/credentials", s.handleAccountCredentials)
			r.Put("/account/credentials/{id}/label", s.handleAccountRenameCredential)
			r.Get("/account/linked", s.handleAccountLinked)
			r.Delete("/account/linked/{provider}", s.handleAccountUnlink)
			r.Get("/account/consents", s.handleAccountConsents)
			r.Delete("/account/consents/{client}", s.handleAccountRevokeConsent)
			r.Get("/account/events", s.handleAccountEvents)
			r.Post("/account/verify-email", s.handleAccountVerifyEmail)
			r.Group(func(r chi.Router) {
				// These re-check the password, so they share the login limit.
				r.Use(s.rateLimit(s.loginLimiter))
				r.Post("/account/password", s.handleAccountPassword)
				r.Post("/account/email", s.handleAccountEmail)
				r.Post("/account/totp/setup", s.handleAccountTOTPSetup)
				r.Post("/account/totp", s.handleAccountTOTPConfirm)
				r.Post("/account/credentials/{id}/delete", s.handleAccountDeleteCredential)
			})
			r.Get("/users", s.handleListUsers)
			r.Get("/users/{sub}", s.handleGetUser)

			r.Route("/admin", func(r chi.Router) {
				r.Use(s.requireAdmin)
				r.Get("/services", s.handleAdminListServices)
				r.Post("/services", s.handleAdminCreateService)
				r.Put("/services/{id}", s.handleAdminUpdateService)
				r.Delete("/services/{id}", s.handleAdminDeleteService)
				r.Get("/audit", s.handleAdminAudit)
				r.Get("/branding", s.handleAdminBranding)
				r.Put("/branding", s.handleAdminUpdateBranding)
				r.With(s.rateLimit(s.uploadLimiter)).Put("/branding/{asset}", s.handleAdminUploadBrandingAsset)
				r.Delete("/branding/{asset}", s.handleAdminDeleteBrandingAsset)
				r.Get("/registrations", s.handleAdminListRegistrations)
				r.Post("/registrations/{id}/approve", s.handleAdminApproveRegistration)
				r.Post("/registrations/{id}/reject", s.handleAdminRejectRegistration)
				r.Patch("/users/{sub}", s.handleAdminUpdateUser)
				r.Post("/users/{sub}/logout", s.handleAdminLogoutUser)
				r.Post("/users/{sub}/actions-email", s.handleAdminActionsEmail)
				r.Get("/keycloak-serverinfo", s.handleKeycloakServerInfo)
				r.HandleFunc("/keycloak", s.handleKeycloakProxy)
				r.HandleFunc("/keycloak/*", s.handleKeycloakProxy)
			})
		})

		r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusNotFound, "not_found", "Ресурс не найден")
		})
	})

	if s.cfg.StaticDir != "" {
		r.NotFound(staticHandler(s.cfg.StaticDir, s.log))
	}
	return r
}

// handleReady is the readiness probe: unready while the database is down so
// Kubernetes stops routing traffic to this pod.
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if s.ready != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.ready(ctx); err != nil {
			s.log.Warn("not ready", "err", err)
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
	}
	w.Write([]byte("ok")) //nolint:errcheck
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		s.log.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", middleware.GetReqID(r.Context()),
		)
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if s.cfg.CookieSecure {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// audit records a security-relevant event. Failures are logged, not returned:
// the user action already happened.
func (s *Server) audit(r *http.Request, actor, action, target string, details map[string]any) {
	e := store.AuditEvent{
		ActorSub:  actor,
		Action:    action,
		Target:    target,
		IP:        clientIP(r),
		UserAgent: truncate(r.UserAgent(), 256),
		Details:   details,
	}
	if err := s.store.RecordAudit(context.WithoutCancel(r.Context()), e); err != nil {
		s.log.Error("audit write failed", "action", action, "err", err)
	}
	s.log.Info("audit", "actor", actor, "action", action, "target", target)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
