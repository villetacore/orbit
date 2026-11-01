// Package config loads Orbit API settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddr    string
	PublicURL     string // origin the browser uses to reach Orbit, e.g. https://orbit.example.com
	StaticDir     string // built frontend; empty disables static serving
	DatabaseURL   string
	SessionSecret string
	SessionTTL    time.Duration
	CookieSecure  bool
	TrustProxy    bool
	SeedDemo      bool

	KeycloakURL         string // public Keycloak base URL, e.g. https://sso.example.com
	KeycloakInternalURL string // optional base URL used by the backend to reach Keycloak
	Realm               string
	ClientID            string
	ClientSecret        string
	AdminClientID       string
	AdminClientSecret   string
	AdminRole           string

	EditableAttributes []string
	VisibleAttributes  []string

	StorageDriver  string // "fs" or "s3"
	StorageDir     string
	S3Endpoint     string
	S3AccessKey    string
	S3SecretKey    string
	S3Bucket       string
	S3UseSSL       bool
	AvatarMaxBytes int64
}

func (c *Config) IssuerURL() string {
	return strings.TrimRight(c.KeycloakURL, "/") + "/realms/" + url.PathEscape(c.Realm)
}

func (c *Config) AccountConsoleURL() string { return c.IssuerURL() + "/account" }

func (c *Config) RedirectURL() string { return c.PublicURL + "/auth/callback" }

func Load() (*Config, error) {
	c := &Config{
		ListenAddr:          env("ORBIT_LISTEN_ADDR", ":8080"),
		PublicURL:           strings.TrimRight(env("ORBIT_PUBLIC_URL", "http://localhost:5173"), "/"),
		StaticDir:           env("ORBIT_STATIC_DIR", ""),
		DatabaseURL:         env("ORBIT_DATABASE_URL", ""),
		SessionSecret:       env("ORBIT_SESSION_SECRET", ""),
		TrustProxy:          envBool("ORBIT_TRUST_PROXY", false),
		SeedDemo:            envBool("ORBIT_SEED_DEMO", false),
		KeycloakURL:         strings.TrimRight(env("ORBIT_KEYCLOAK_URL", "http://localhost:8081"), "/"),
		KeycloakInternalURL: strings.TrimRight(env("ORBIT_KEYCLOAK_INTERNAL_URL", ""), "/"),
		Realm:               env("ORBIT_KEYCLOAK_REALM", "orbit"),
		ClientID:            env("ORBIT_OIDC_CLIENT_ID", "orbit-web"),
		ClientSecret:        env("ORBIT_OIDC_CLIENT_SECRET", ""),
		AdminClientID:       env("ORBIT_KEYCLOAK_ADMIN_CLIENT_ID", "orbit-admin-api"),
		AdminClientSecret:   env("ORBIT_KEYCLOAK_ADMIN_CLIENT_SECRET", ""),
		AdminRole:           env("ORBIT_ADMIN_ROLE", "orbit-admin"),
		EditableAttributes:  envList("ORBIT_EDITABLE_ATTRIBUTES", "phoneNumber,jobTitle"),
		VisibleAttributes:   envList("ORBIT_VISIBLE_ATTRIBUTES", "department"),
		StorageDriver:       env("ORBIT_STORAGE_DRIVER", "fs"),
		StorageDir:          env("ORBIT_STORAGE_DIR", "./data/avatars"),
		S3Endpoint:          env("ORBIT_S3_ENDPOINT", ""),
		S3AccessKey:         env("ORBIT_S3_ACCESS_KEY", ""),
		S3SecretKey:         env("ORBIT_S3_SECRET_KEY", ""),
		S3Bucket:            env("ORBIT_S3_BUCKET", "orbit-avatars"),
		S3UseSSL:            envBool("ORBIT_S3_USE_SSL", false),
	}

	var err error
	if c.SessionTTL, err = time.ParseDuration(env("ORBIT_SESSION_TTL", "12h")); err != nil {
		return nil, fmt.Errorf("ORBIT_SESSION_TTL: %w", err)
	}
	if c.AvatarMaxBytes, err = strconv.ParseInt(env("ORBIT_AVATAR_MAX_BYTES", "5242880"), 10, 64); err != nil {
		return nil, fmt.Errorf("ORBIT_AVATAR_MAX_BYTES: %w", err)
	}
	c.CookieSecure = envBool("ORBIT_COOKIE_SECURE", strings.HasPrefix(c.PublicURL, "https://"))

	return c, c.validate()
}

func (c *Config) validate() error {
	var errs []error
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("ORBIT_DATABASE_URL is required"))
	}
	if len(c.SessionSecret) < 32 {
		errs = append(errs, errors.New("ORBIT_SESSION_SECRET must be at least 32 characters"))
	}
	if c.ClientSecret == "" {
		errs = append(errs, errors.New("ORBIT_OIDC_CLIENT_SECRET is required"))
	}
	if c.AdminClientSecret == "" {
		errs = append(errs, errors.New("ORBIT_KEYCLOAK_ADMIN_CLIENT_SECRET is required"))
	}
	if u, err := url.Parse(c.PublicURL); err != nil || u.Scheme == "" || u.Host == "" || (u.Path != "" && u.Path != "/") {
		errs = append(errs, errors.New("ORBIT_PUBLIC_URL must be an origin such as https://orbit.example.com"))
	}
	switch c.StorageDriver {
	case "fs":
	case "s3":
		if c.S3Endpoint == "" || c.S3AccessKey == "" || c.S3SecretKey == "" {
			errs = append(errs, errors.New("ORBIT_S3_ENDPOINT, ORBIT_S3_ACCESS_KEY and ORBIT_S3_SECRET_KEY are required for s3 storage"))
		}
	default:
		errs = append(errs, fmt.Errorf("unknown ORBIT_STORAGE_DRIVER %q", c.StorageDriver))
	}
	for _, a := range c.EditableAttributes {
		if isReservedAttribute(a) {
			errs = append(errs, fmt.Errorf("attribute %q cannot be user-editable", a))
		}
	}
	return errors.Join(errs...)
}

// isReservedAttribute lists attributes that identify the user or are managed by Orbit itself.
func isReservedAttribute(name string) bool {
	switch name {
	case "username", "email", "emailVerified", "firstName", "lastName", "picture":
		return true
	}
	return false
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func envList(key, def string) []string {
	var out []string
	for _, p := range strings.Split(env(key, def), ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
