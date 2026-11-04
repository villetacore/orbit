// Package keycloak is a client for the Keycloak Admin REST API, authenticated
// as a dedicated service account (realm-management: realm-admin, because Orbit
// manages every realm setting). Never exposed to the browser.
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

// Error is any other non-success answer from the Admin API. Message is
// Keycloak's own explanation, e.g. a password policy violation.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("keycloak: status %d: %s", e.Status, e.Message)
}

// NewError builds an *Error from a response, extracting Keycloak's message
// from whichever field this endpoint happens to use.
func NewError(status int, body []byte) *Error {
	var m struct {
		ErrorMessage string `json:"errorMessage"`
		Description  string `json:"error_description"`
		Error        string `json:"error"`
	}
	msg := strings.TrimSpace(string(body))
	if json.Unmarshal(body, &m) == nil {
		switch {
		case m.ErrorMessage != "":
			msg = m.ErrorMessage
		case m.Description != "":
			msg = m.Description
		case m.Error != "":
			msg = m.Error
		}
	}
	return &Error{Status: status, Message: msg}
}

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
	// Credentials are write-only here; see AddOTPCredential.
	Credentials []credentialInput `json:"credentials,omitempty"`
}

type credentialInput struct {
	Type           string `json:"type"`
	UserLabel      string `json:"userLabel,omitempty"`
	SecretData     string `json:"secretData"`
	CredentialData string `json:"credentialData"`
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

// OTPCredential is a verified TOTP secret to store for a user. Secret is the
// raw value Keycloak keeps; authenticator apps get its Base32 form.
type OTPCredential struct {
	Secret    string
	Label     string
	Digits    int
	Period    int
	Algorithm string // HmacSHA1, HmacSHA256 or HmacSHA512
}

// RealmSettings is the subset of the realm representation Orbit itself reads.
type RealmSettings struct {
	DisplayName         string `json:"displayName"`
	EditUsernameAllowed bool   `json:"editUsernameAllowed"`
	OTPPolicyType       string `json:"otpPolicyType"`
	OTPPolicyAlgorithm  string `json:"otpPolicyAlgorithm"`
	OTPPolicyDigits     int    `json:"otpPolicyDigits"`
	OTPPolicyPeriod     int    `json:"otpPolicyPeriod"`
	OTPPolicyLookAhead  int    `json:"otpPolicyLookAheadWindow"`
}

// Consent is an application the user granted access to.
type Consent struct {
	ClientID            string   `json:"clientId"`
	GrantedClientScopes []string `json:"grantedClientScopes"`
	CreatedDate         int64    `json:"createdDate"`
	LastUpdatedDate     int64    `json:"lastUpdatedDate"`
}

// FederatedIdentity links the user to an external identity provider.
type FederatedIdentity struct {
	IdentityProvider string `json:"identityProvider"`
	UserID           string `json:"userId"`
	UserName         string `json:"userName"`
}

// IdentityProvider is an external provider configured in the realm.
type IdentityProvider struct {
	Alias       string `json:"alias"`
	DisplayName string `json:"displayName"`
	ProviderID  string `json:"providerId"`
	Enabled     bool   `json:"enabled"`
}

// Event is a Keycloak login event.
type Event struct {
	Time      int64             `json:"time"`
	Type      string            `json:"type"`
	ClientID  string            `json:"clientId"`
	IPAddress string            `json:"ipAddress"`
	Error     string            `json:"error"`
	Details   map[string]string `json:"details"`
}

// RawResponse is an Admin API answer passed through untouched.
type RawResponse struct {
	Status      int
	ContentType string
	Location    string
	Body        []byte
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

// FindUserByLogin resolves what a person types into a login form: a username
// or an email address. ErrNotFound when neither matches exactly.
func (a *Admin) FindUserByLogin(ctx context.Context, login string) (*User, error) {
	fields := []string{"username"}
	if strings.Contains(login, "@") {
		fields = append(fields, "email")
	}
	for _, field := range fields {
		q := url.Values{field: {login}, "exact": {"true"}, "briefRepresentation": {"false"}}
		var us []User
		if err := a.do(ctx, http.MethodGet, "/users?"+q.Encode(), nil, &us); err != nil {
			return nil, err
		}
		if len(us) > 0 {
			return &us[0], nil
		}
	}
	return nil, ErrNotFound
}

// AddOTPCredential stores a TOTP secret the user has already proven to hold.
// The Admin API accepts credentials only inside a full user update.
func (a *Admin) AddOTPCredential(ctx context.Context, id string, c OTPCredential) error {
	u, err := a.GetUser(ctx, id)
	if err != nil {
		return err
	}
	secret, err := json.Marshal(map[string]string{"value": c.Secret})
	if err != nil {
		return err
	}
	data, err := json.Marshal(map[string]any{
		"subType": "totp", "digits": c.Digits, "counter": 0, "period": c.Period, "algorithm": c.Algorithm,
	})
	if err != nil {
		return err
	}
	u.Credentials = []credentialInput{{Type: "otp", UserLabel: c.Label, SecretData: string(secret), CredentialData: string(data)}}
	return a.UpdateUser(ctx, u)
}

func (a *Admin) DeleteCredential(ctx context.Context, id, credentialID string) error {
	return a.do(ctx, http.MethodDelete, "/users/"+url.PathEscape(id)+"/credentials/"+url.PathEscape(credentialID), nil, nil)
}

// SetCredentialLabel renames a credential; this endpoint takes plain text.
func (a *Admin) SetCredentialLabel(ctx context.Context, id, credentialID, label string) error {
	path := "/users/" + url.PathEscape(id) + "/credentials/" + url.PathEscape(credentialID) + "/userLabel"
	resp, err := a.Raw(ctx, http.MethodPut, "/admin/realms/"+url.PathEscape(a.realm)+path, []byte(label), "text/plain")
	if err != nil {
		return err
	}
	if resp.Status >= 300 {
		return NewError(resp.Status, resp.Body)
	}
	return nil
}

func (a *Admin) GetRealm(ctx context.Context) (*RealmSettings, error) {
	var r RealmSettings
	if err := a.do(ctx, http.MethodGet, "", nil, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (a *Admin) UserConsents(ctx context.Context, id string) ([]Consent, error) {
	var cs []Consent
	err := a.do(ctx, http.MethodGet, "/users/"+url.PathEscape(id)+"/consents", nil, &cs)
	return cs, err
}

func (a *Admin) DeleteConsent(ctx context.Context, id, clientID string) error {
	return a.do(ctx, http.MethodDelete, "/users/"+url.PathEscape(id)+"/consents/"+url.PathEscape(clientID), nil, nil)
}

func (a *Admin) FederatedIdentities(ctx context.Context, id string) ([]FederatedIdentity, error) {
	var fs []FederatedIdentity
	err := a.do(ctx, http.MethodGet, "/users/"+url.PathEscape(id)+"/federated-identity", nil, &fs)
	return fs, err
}

func (a *Admin) DeleteFederatedIdentity(ctx context.Context, id, provider string) error {
	return a.do(ctx, http.MethodDelete, "/users/"+url.PathEscape(id)+"/federated-identity/"+url.PathEscape(provider), nil, nil)
}

func (a *Admin) IdentityProviders(ctx context.Context) ([]IdentityProvider, error) {
	var ps []IdentityProvider
	err := a.do(ctx, http.MethodGet, "/identity-provider/instances", nil, &ps)
	return ps, err
}

// UserEvents returns the user's newest login events. Empty unless the realm
// stores events.
func (a *Admin) UserEvents(ctx context.Context, id string, limit int) ([]Event, error) {
	q := url.Values{"user": {id}, "max": {strconv.Itoa(limit)}}
	var es []Event
	err := a.do(ctx, http.MethodGet, "/events?"+q.Encode(), nil, &es)
	return es, err
}

// SendVerifyEmail asks Keycloak to email the user a confirmation link.
func (a *Admin) SendVerifyEmail(ctx context.Context, id string) error {
	return a.do(ctx, http.MethodPut, "/users/"+url.PathEscape(id)+"/send-verify-email", nil, nil)
}

// maxRawResponse bounds what Raw buffers; /admin/serverinfo is about 1 MiB.
const maxRawResponse = 16 << 20

// Raw calls an arbitrary Admin API path (starting at /admin) with the service
// account and returns the answer as is. Non-success statuses are not errors.
func (a *Admin) Raw(ctx context.Context, method, path string, body []byte, contentType string) (*RawResponse, error) {
	var rdr io.Reader
	if len(body) > 0 {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("keycloak %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(io.LimitReader(resp.Body, maxRawResponse))
	if err != nil {
		return nil, fmt.Errorf("keycloak %s %s: %w", method, path, err)
	}
	return &RawResponse{
		Status:      resp.StatusCode,
		ContentType: resp.Header.Get("Content-Type"),
		Location:    resp.Header.Get("Location"),
		Body:        out,
	}, nil
}

// RealmPath returns the Admin API prefix of the managed realm for Raw.
func (a *Admin) RealmPath() string { return "/admin/realms/" + url.PathEscape(a.realm) }

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
		return fmt.Errorf("keycloak %s %s: %w", method, path, NewError(resp.StatusCode, msg))
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
