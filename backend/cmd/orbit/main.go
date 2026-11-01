// Command orbit runs the Orbit API (backend-for-frontend over Keycloak).
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/villetacore/orbit/backend/internal/api"
	"github.com/villetacore/orbit/backend/internal/auth"
	"github.com/villetacore/orbit/backend/internal/avatar"
	"github.com/villetacore/orbit/backend/internal/config"
	"github.com/villetacore/orbit/backend/internal/keycloak"
	"github.com/villetacore/orbit/backend/internal/seal"
	"github.com/villetacore/orbit/backend/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	defer pool.Close()
	st := store.NewPostgres(pool)
	if err := retry(ctx, log, "database", func() error { return st.Migrate(ctx) }); err != nil {
		return err
	}
	if cfg.SeedDemo {
		if err := st.SeedDemoServices(ctx, cfg.KeycloakURL, cfg.Realm, cfg.AdminRole); err != nil {
			return fmt.Errorf("seed demo: %w", err)
		}
	}

	kcHTTP, err := keycloak.NewHTTPClient(cfg.KeycloakURL, cfg.KeycloakInternalURL)
	if err != nil {
		return err
	}
	var provider *auth.Provider
	err = retry(ctx, log, "keycloak", func() (err error) {
		provider, err = auth.NewProvider(ctx, cfg.IssuerURL(), cfg.ClientID, cfg.ClientSecret, cfg.RedirectURL(), kcHTTP)
		return err
	})
	if err != nil {
		return err
	}

	sealer, err := seal.New(cfg.SessionSecret)
	if err != nil {
		return err
	}

	var avatars avatar.Storage
	switch cfg.StorageDriver {
	case "s3":
		avatars, err = avatar.NewS3(ctx, cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Bucket, cfg.S3UseSSL)
	default:
		avatars, err = avatar.NewFS(cfg.StorageDir)
	}
	if err != nil {
		return fmt.Errorf("avatar storage: %w", err)
	}

	handler := api.New(api.Deps{
		Config:   cfg,
		OIDC:     provider,
		Sessions: auth.NewManager(st, sealer, cfg.SessionTTL),
		Sealer:   sealer,
		Keycloak: keycloak.NewAdmin(cfg.KeycloakURL, cfg.Realm, cfg.AdminClientID, cfg.AdminClientSecret, kcHTTP),
		Store:    st,
		Avatars:  avatars,
		Logger:   log,
	})

	go sweepSessions(ctx, log, st)

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.ListenAddr, "public_url", cfg.PublicURL)
		errCh <- srv.ListenAndServe()
	}()
	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// retry waits for dependencies that start slower than Orbit (docker-compose).
func retry(ctx context.Context, log *slog.Logger, what string, fn func() error) error {
	var err error
	for attempt := 1; attempt <= 30; attempt++ {
		if err = fn(); err == nil {
			return nil
		}
		log.Warn("dependency not ready", "dependency", what, "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return fmt.Errorf("%s: %w", what, err)
}

func sweepSessions(ctx context.Context, log *slog.Logger, st *store.Postgres) {
	t := time.NewTicker(15 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := st.DeleteExpiredSessions(ctx); err != nil {
				log.Error("sweep sessions", "err", err)
			} else if n > 0 {
				log.Info("expired sessions removed", "count", n)
			}
		}
	}
}
