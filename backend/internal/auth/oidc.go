// Package auth implements sign-in against Keycloak (Orbit's own form via the
// password grant, and Authorization Code + PKCE for browser-only methods) and
// server-side sessions. Tokens never leave the backend.
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Claims are the ID token claims Orbit relies on. Roles and groups come from
// protocol mappers configured on the Orbit client in Keycloak.
type Claims struct {
	Subject           string   `json:"sub"`
	Email             string   `json:"email"`
	EmailVerified     bool     `json:"email_verified"`
	Name              string   `json:"name"`
	PreferredUsername string   `json:"preferred_username"`
	GivenName         string   `json:"given_name"`
	FamilyName        string   `json:"family_name"`
	Roles             []string `json:"roles"`
	Groups            []string `json:"groups"`
	// SessionID is Keycloak's session ("sid"), used to mark the current session.
	SessionID string `json:"sid,omitempty"`
	Nonce     string `json:"nonce,omitempty"`
}

func (c Claims) HasRole(role string) bool { return slices.Contains(c.Roles, role) }

type Tokens struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	IDToken      string    `json:"id_token"`
	Expiry       time.Time `json:"expiry"`
}

// ErrRefreshRejected means the IdP refused the refresh token (session ended
// in Keycloak), as opposed to a transient failure.
var ErrRefreshRejected = errors.New("auth: refresh token rejected")

// Password grant outcomes. Keycloak answers a wrong password, a missing or
// wrong one-time code, an unknown user and a locked account identically on
// purpose, so ErrInvalidCredentials covers all of them.
var (
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	ErrAccountDisabled    = errors.New("auth: account disabled")
	// ErrAccountSetup means the credentials are right but the account has
	// pending required actions, so Keycloak issues no tokens yet.
	ErrAccountSetup = errors.New("auth: account setup required")
	// ErrPasswordGrantDisabled means the client has "Direct access grants" off.
	ErrPasswordGrantDisabled = errors.New("auth: password grant disabled for client")
)

// PasswordLogin is what a person typed into Orbit's sign-in form.
type PasswordLogin struct {
	Username string
	Password string
	OTP      string
	// ClientIP is forwarded so Keycloak's sessions and events show the user's
	// address when it is configured to trust X-Forwarded-For.
	ClientIP string
}

type Provider struct {
	oauth      oauth2.Config
	verifier   *oidc.IDTokenVerifier
	endSession string
	client     *http.Client
}

// postForm sends an authenticated form request to one of the IdP's endpoints.
func (p *Provider) postForm(ctx context.Context, endpoint string, form url.Values, clientIP string) (*http.Response, error) {
	form.Set("client_id", p.oauth.ClientID)
	form.Set("client_secret", p.oauth.ClientSecret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if clientIP != "" {
		req.Header.Set("X-Forwarded-For", clientIP)
	}
	return p.client.Do(req)
}

// Login signs a user in with the OAuth2 password grant, without sending the
// browser to Keycloak. Keycloak still runs its "direct grant" flow: password
// check, one-time code, brute-force detection and account state.
func (p *Provider) Login(ctx context.Context, in PasswordLogin) (Claims, Tokens, error) {
	form := url.Values{
		"grant_type": {"password"},
		"username":   {in.Username},
		"password":   {in.Password},
		"scope":      {strings.Join(p.oauth.Scopes, " ")},
	}
	if in.OTP != "" {
		form.Set("totp", in.OTP)
	}
	resp, err := p.postForm(ctx, p.oauth.Endpoint.TokenURL, form, in.ClientIP)
	if err != nil {
		return Claims{}, Tokens{}, fmt.Errorf("password grant: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Claims{}, Tokens{}, fmt.Errorf("password grant: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		_ = json.Unmarshal(body, &e)
		return Claims{}, Tokens{}, passwordGrantError(resp.StatusCode, e.Error, e.Description)
	}
	var t struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &t); err != nil {
		return Claims{}, Tokens{}, fmt.Errorf("password grant response: %w", err)
	}
	tok := (&oauth2.Token{
		AccessToken:  t.AccessToken,
		RefreshToken: t.RefreshToken,
		Expiry:       time.Now().Add(time.Duration(t.ExpiresIn) * time.Second),
	}).WithExtra(map[string]any{"id_token": t.IDToken})
	return p.verify(oidc.ClientContext(ctx, p.client), tok)
}

func passwordGrantError(status int, code, description string) error {
	switch {
	case code == "invalid_grant" && description == "Account disabled":
		return ErrAccountDisabled
	case code == "invalid_grant" && description == "Account is not fully set up":
		return ErrAccountSetup
	case code == "invalid_grant":
		return ErrInvalidCredentials
	case code == "unauthorized_client":
		return ErrPasswordGrantDisabled
	}
	return fmt.Errorf("password grant: status %d: %s: %s", status, code, description)
}

// EndSession ends the Keycloak session behind a refresh token from the
// backend, so signing out needs no redirect through Keycloak.
func (p *Provider) EndSession(ctx context.Context, refreshToken string) error {
	if p.endSession == "" {
		return errors.New("end session: IdP has no end_session_endpoint")
	}
	resp, err := p.postForm(ctx, p.endSession, url.Values{"refresh_token": {refreshToken}}, "")
	if err != nil {
		return fmt.Errorf("end session: %w", err)
	}
	defer resp.Body.Close()
	// A session that is already gone is what the caller wanted.
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusBadRequest {
		return fmt.Errorf("end session: status %d", resp.StatusCode)
	}
	return nil
}

func NewProvider(ctx context.Context, issuer, clientID, clientSecret, redirectURL string, client *http.Client) (*Provider, error) {
	ctx = oidc.ClientContext(ctx, client)
	p, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}
	var meta struct {
		EndSession string `json:"end_session_endpoint"`
	}
	if err := p.Claims(&meta); err != nil {
		return nil, fmt.Errorf("oidc metadata: %w", err)
	}
	return &Provider{
		oauth: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Endpoint:     p.Endpoint(),
			RedirectURL:  redirectURL,
			Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
		},
		// Verifies signature, issuer, audience (client ID) and expiry.
		verifier:   p.Verifier(&oidc.Config{ClientID: clientID}),
		endSession: meta.EndSession,
		client:     client,
	}, nil
}

// AuthCodeURL builds the authorization request; extra adds parameters such as
// kc_action for Keycloak application-initiated actions.
func (p *Provider) AuthCodeURL(state, nonce, verifier string, extra map[string]string) string {
	opts := []oauth2.AuthCodeOption{oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)}
	for k, v := range extra {
		opts = append(opts, oauth2.SetAuthURLParam(k, v))
	}
	return p.oauth.AuthCodeURL(state, opts...)
}

func (p *Provider) Exchange(ctx context.Context, code, verifier, nonce string) (Claims, Tokens, error) {
	ctx = oidc.ClientContext(ctx, p.client)
	tok, err := p.oauth.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return Claims{}, Tokens{}, fmt.Errorf("code exchange: %w", err)
	}
	claims, tokens, err := p.verify(ctx, tok)
	if err != nil {
		return Claims{}, Tokens{}, err
	}
	if claims.Nonce == "" || claims.Nonce != nonce {
		return Claims{}, Tokens{}, errors.New("id token nonce mismatch")
	}
	return claims, tokens, nil
}

func (p *Provider) Refresh(ctx context.Context, refreshToken string) (Claims, Tokens, error) {
	ctx = oidc.ClientContext(ctx, p.client)
	tok, err := p.oauth.TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken}).Token()
	if err != nil {
		var re *oauth2.RetrieveError
		if errors.As(err, &re) && re.Response != nil && re.Response.StatusCode >= 400 && re.Response.StatusCode < 500 {
			return Claims{}, Tokens{}, fmt.Errorf("%w: %v", ErrRefreshRejected, err)
		}
		return Claims{}, Tokens{}, fmt.Errorf("refresh: %w", err)
	}
	claims, tokens, err := p.verify(ctx, tok)
	if err != nil {
		return Claims{}, Tokens{}, err
	}
	if tokens.RefreshToken == "" {
		tokens.RefreshToken = refreshToken
	}
	return claims, tokens, nil
}

func (p *Provider) verify(ctx context.Context, tok *oauth2.Token) (Claims, Tokens, error) {
	raw, _ := tok.Extra("id_token").(string)
	if raw == "" {
		return Claims{}, Tokens{}, errors.New("token response has no id_token")
	}
	idt, err := p.verifier.Verify(ctx, raw)
	if err != nil {
		return Claims{}, Tokens{}, fmt.Errorf("verify id token: %w", err)
	}
	var c Claims
	if err := idt.Claims(&c); err != nil {
		return Claims{}, Tokens{}, fmt.Errorf("id token claims: %w", err)
	}
	if c.Subject == "" {
		return Claims{}, Tokens{}, errors.New("id token has no sub")
	}
	return c, Tokens{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		IDToken:      raw,
		Expiry:       tok.Expiry,
	}, nil
}
