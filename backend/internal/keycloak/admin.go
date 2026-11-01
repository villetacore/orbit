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
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

var (
	ErrNotFound = errors.New("keycloak: not found")
	// ErrConflict is a uniqueness violation, e.g. an email already in use.
	ErrConflict = errors.New("keycloak: conflict")
)

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
	RequiredActions  []string            `json:"requiredActions,omitempty"`
	// Set for service-account users of confidential clients.
	ServiceAccountClientID string `json:"serviceAccountClientId,omitempty"`
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

type Role struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Session is a Keycloak user session; Clients maps client IDs to names.
type Session struct {
	ID         string            `json:"id"`
	IPAddress  string            `json:"ipAddress"`
	Start      int64             `json:"start"`
	LastAccess int64             `json:"lastAccess"`
	Clients    map[string]string `json:"clients"`
}

// Credential omits secretData and credentialData on purpose.
type Credential struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	UserLabel   string `json:"userLabel,omitempty"`
	CreatedDate int64  `json:"createdDate,omitempty"`
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

// CreateUser creates a user and returns its ID (from the Location header).
// ErrConflict means the username or email is taken.
func (a *Admin) CreateUser(ctx context.Context, u *User) (string, error) {
	b, err := json.Marshal(u)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.base+"/admin/realms/"+url.PathEscape(a.realm)+"/users", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("keycloak create user: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusConflict {
		return "", ErrConflict
	}
	if resp.StatusCode != http.StatusCreated {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("keycloak create user: status %d: %s", resp.StatusCode, msg)
	}
	loc := resp.Header.Get("Location")
	id := loc[strings.LastIndex(loc, "/")+1:]
	if id == "" {
		return "", errors.New("keycloak create user: no id in Location")
	}
	return id, nil
}

// SetPassword sets a password; temporary forces a change at next sign-in.
func (a *Admin) SetPassword(ctx context.Context, id, password string, temporary bool) error {
	body := map[string]any{"type": "password", "value": password, "temporary": temporary}
	return a.do(ctx, http.MethodPut, "/users/"+url.PathEscape(id)+"/reset-password", body, nil)
}

// ListUsers searches users by username, name or email ("" lists everyone).
func (a *Admin) ListUsers(ctx context.Context, search string, first, max int) ([]User, error) {
	q := url.Values{}
	if search != "" {
		q.Set("search", search)
	}
	q.Set("first", strconv.Itoa(first))
	q.Set("max", strconv.Itoa(max))
	// The full representation carries attributes (department, picture...).
	q.Set("briefRepresentation", "false")
	var us []User
	err := a.do(ctx, http.MethodGet, "/users?"+q.Encode(), nil, &us)
	return us, err
}

// UserRealmRoles returns the user's effective realm roles.
func (a *Admin) UserRealmRoles(ctx context.Context, id string) ([]Role, error) {
	var rs []Role
	err := a.do(ctx, http.MethodGet, "/users/"+url.PathEscape(id)+"/role-mappings/realm/composite?briefRepresentation=true", nil, &rs)
	return rs, err
}

func (a *Admin) UserSessions(ctx context.Context, id string) ([]Session, error) {
	var ss []Session
	err := a.do(ctx, http.MethodGet, "/users/"+url.PathEscape(id)+"/sessions", nil, &ss)
	return ss, err
}

// DeleteSession ends one user session in the realm.
func (a *Admin) DeleteSession(ctx context.Context, sessionID string) error {
	return a.do(ctx, http.MethodDelete, "/sessions/"+url.PathEscape(sessionID), nil, nil)
}

// LogoutUser ends all of the user's sessions.
func (a *Admin) LogoutUser(ctx context.Context, id string) error {
	return a.do(ctx, http.MethodPost, "/users/"+url.PathEscape(id)+"/logout", nil, nil)
}

// UserCredentials lists the user's credentials; secret data is never requested.
func (a *Admin) UserCredentials(ctx context.Context, id string) ([]Credential, error) {
	var cs []Credential
	err := a.do(ctx, http.MethodGet, "/users/"+url.PathEscape(id)+"/credentials", nil, &cs)
	return cs, err
}

// ExecuteActionsEmail emails the user a link to perform required actions
// (UPDATE_PASSWORD, VERIFY_EMAIL, CONFIGURE_TOTP). Needs SMTP in the realm.
func (a *Admin) ExecuteActionsEmail(ctx context.Context, id string, actions []string) error {
	return a.do(ctx, http.MethodPut, "/users/"+url.PathEscape(id)+"/execute-actions-email", actions, nil)
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
	if resp.StatusCode == http.StatusConflict {
		return ErrConflict
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
