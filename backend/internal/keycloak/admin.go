// Package keycloak is a minimal client for the Keycloak Admin REST API,
// authenticated as a dedicated service account with least privilege
// (realm-management: view-users, manage-users). Never exposed to the browser.
package keycloak

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

var ErrNotFound = errors.New("keycloak: not found")

type User struct {
	ID               string              `json:"id"`
	Username         string              `json:"username"`
	Email            string              `json:"email,omitempty"`
	EmailVerified    bool                `json:"emailVerified"`
	FirstName        string              `json:"firstName"`
	LastName         string              `json:"lastName"`
	Enabled          bool                `json:"enabled"`
	CreatedTimestamp int64               `json:"createdTimestamp,omitempty"`
	Attributes       map[string][]string `json:"attributes"`
}

// Attr returns the first value of a user attribute.
func (u *User) Attr(name string) string {
	if v := u.Attributes[name]; len(v) > 0 {
		return v[0]
	}
	return ""
}

func (u *User) SetAttr(name, value string) {
	if u.Attributes == nil {
		u.Attributes = map[string][]string{}
	}
	if value == "" {
		delete(u.Attributes, name)
		return
	}
	u.Attributes[name] = []string{value}
}

type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type Admin struct {
	base   string
	realm  string
	client *http.Client
}

func NewAdmin(baseURL, realm, clientID, clientSecret string, httpClient *http.Client) *Admin {
	base := strings.TrimRight(baseURL, "/")
	cc := clientcredentials.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		TokenURL:     base + "/realms/" + url.PathEscape(realm) + "/protocol/openid-connect/token",
	}
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, httpClient)
	client := cc.Client(ctx)
	client.Timeout = 15 * time.Second
	return &Admin{base: base, realm: realm, client: client}
}

func (a *Admin) GetUser(ctx context.Context, id string) (*User, error) {
	var u User
	if err := a.do(ctx, http.MethodGet, "/users/"+url.PathEscape(id), nil, &u); err != nil {
		return nil, err
	}
	return &u, nil
}

// UpdateUser sends the full representation: Keycloak's user profile treats
// omitted attributes as removed, so callers must Get, modify and Update.
func (a *Admin) UpdateUser(ctx context.Context, u *User) error {
	return a.do(ctx, http.MethodPut, "/users/"+url.PathEscape(u.ID), u, nil)
}

func (a *Admin) UserGroups(ctx context.Context, id string) ([]Group, error) {
	var gs []Group
	err := a.do(ctx, http.MethodGet, "/users/"+url.PathEscape(id)+"/groups?briefRepresentation=true", nil, &gs)
	return gs, err
}

func (a *Admin) do(ctx context.Context, method, path string, body, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+"/admin/realms/"+url.PathEscape(a.realm)+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("keycloak %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("keycloak %s %s: status %d: %s", method, path, resp.StatusCode, msg)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// NewHTTPClient returns a client for backend-to-Keycloak calls. When
// internalURL is set (e.g. inside docker-compose) requests addressed to the
// public URL are routed to it, so token issuers stay consistent with what
// browsers see.
func NewHTTPClient(publicURL, internalURL string) (*http.Client, error) {
	c := &http.Client{Timeout: 15 * time.Second}
	if internalURL == "" || internalURL == publicURL {
		return c, nil
	}
	from, err := url.Parse(publicURL)
	if err != nil {
		return nil, err
	}
	to, err := url.Parse(internalURL)
	if err != nil {
		return nil, err
	}
	c.Transport = &rewriteTransport{from: from, to: to, next: http.DefaultTransport}
	return c, nil
}

type rewriteTransport struct {
	from, to *url.URL
	next     http.RoundTripper
}

func (t *rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme == t.from.Scheme && req.URL.Host == t.from.Host {
		req = req.Clone(req.Context())
		req.URL.Scheme = t.to.Scheme
		req.URL.Host = t.to.Host
		req.Host = t.from.Host
	}
	return t.next.RoundTrip(req)
}
