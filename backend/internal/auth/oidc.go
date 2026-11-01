// Package auth implements the OIDC Authorization Code + PKCE flow against
// Keycloak and server-side sessions. Tokens never leave the backend.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
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
	Nonce             string   `json:"nonce,omitempty"`
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

type Provider struct {
	oauth      oauth2.Config
	verifier   *oidc.IDTokenVerifier
	endSession string
	client     *http.Client
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

// LogoutURL builds the RP-initiated logout URL that ends the Keycloak session.
func (p *Provider) LogoutURL(idToken, postLogoutRedirect string) string {
	if p.endSession == "" {
		return postLogoutRedirect
	}
	u, err := url.Parse(p.endSession)
	if err != nil {
		return postLogoutRedirect
	}
	q := u.Query()
	q.Set("client_id", p.oauth.ClientID)
	q.Set("post_logout_redirect_uri", postLogoutRedirect)
	if idToken != "" {
		q.Set("id_token_hint", idToken)
	}
	u.RawQuery = q.Encode()
	return u.String()
}
