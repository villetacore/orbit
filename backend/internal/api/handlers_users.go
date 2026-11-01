package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/villetacore/orbit/backend/internal/keycloak"
)

// Users directory: every signed-in user can find colleagues (name, email,
// visible attributes, groups); disabled and service accounts are only shown
// to administrators. Administrators can also edit users, enable or disable
// them, end their sessions and email them required actions.

const directoryPageSize = 30

type directoryAttribute struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type directoryUser struct {
	Sub        string               `json:"sub"`
	Username   string               `json:"username"`
	Name       string               `json:"name"`
	FirstName  string               `json:"firstName"`
	LastName   string               `json:"lastName"`
	Email      string               `json:"email"`
	Enabled    bool                 `json:"enabled"`
	Attributes []directoryAttribute `json:"attributes"`
	AvatarURL  string               `json:"avatarUrl"`
}

// userDetail adds groups for everyone and account state for administrators.
type userDetail struct {
	directoryUser
	Groups []string `json:"groups"`

	EmailVerified *bool            `json:"emailVerified,omitempty"`
	CreatedAt     *time.Time       `json:"createdAt,omitempty"`
	Roles         []string         `json:"roles,omitempty"`
	Sessions      []sessionView    `json:"sessions,omitempty"`
	Credentials   []credentialView `json:"credentials,omitempty"`
	// AttributeNames lists every attribute an administrator may fill in,
	// including ones the user has left empty.
	AttributeNames []string `json:"attributeNames,omitempty"`
	Self           bool     `json:"self"`
}

func isServiceAccount(u *keycloak.User) bool {
	return u.ServiceAccountClientID != "" || strings.HasPrefix(u.Username, "service-account-")
}

func displayName(u *keycloak.User) string {
	if n := strings.TrimSpace(u.FirstName + " " + u.LastName); n != "" {
		return n
	}
	return u.Username
}

func (s *Server) directoryUserFor(r *http.Request, u *keycloak.User) directoryUser {
	d := directoryUser{
		Sub:        u.ID,
		Username:   u.Username,
		Name:       displayName(u),
		FirstName:  u.FirstName,
		LastName:   u.LastName,
		Email:      u.Email,
		Enabled:    u.Enabled,
		Attributes: []directoryAttribute{},
		AvatarURL:  s.avatarURLFor(r, u.ID),
	}
	// Only attributes the deployment exposes; everything else in Keycloak
	// (picture, technical attributes) stays private.
	for _, name := range s.directoryAttributes() {
		if v := u.Attr(name); v != "" {
			d.Attributes = append(d.Attributes, directoryAttribute{Name: name, Value: v})
		}
	}
	return d
}

func (s *Server) directoryAttributes() []string {
	names := slices.Clone(s.cfg.EditableAttributes)
	for _, n := range s.cfg.VisibleAttributes {
		if !slices.Contains(names, n) {
			names = append(names, n)
		}
	}
	return names
}

func (s *Server) isAdmin(r *http.Request) bool {
	return sessionFrom(r.Context()).Claims.HasRole(s.cfg.AdminRole)
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("q"))
	if len(search) > 100 {
		writeError(w, http.StatusBadRequest, "bad_request", "Слишком длинный запрос")
		return
	}
	page, _ := strconv.Atoi(q.Get("page"))
	page = max(page, 0)
	// One extra row tells whether there is a next page.
	us, err := s.kc.ListUsers(r.Context(), search, page*directoryPageSize, directoryPageSize+1)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	hasMore := len(us) > directoryPageSize
	if hasMore {
		us = us[:directoryPageSize]
	}
	admin := s.isAdmin(r)
	out := make([]directoryUser, 0, len(us))
	for i := range us {
		u := &us[i]
		if !admin && (!u.Enabled || isServiceAccount(u)) {
			continue
		}
		out = append(out, s.directoryUserFor(r, u))
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out, "hasMore": hasMore})
}

// visibleUser loads a user the caller may see; hidden users are reported as
// missing, not forbidden.
func (s *Server) visibleUser(w http.ResponseWriter, r *http.Request) (*keycloak.User, bool) {
	sub := chi.URLParam(r, "sub")
	if !isKeycloakID(sub) {
		writeError(w, http.StatusNotFound, "not_found", "Пользователь не найден")
		return nil, false
	}
	u, err := s.kc.GetUser(r.Context(), sub)
	if errors.Is(err, keycloak.ErrNotFound) || err == nil && !s.isAdmin(r) && (!u.Enabled || isServiceAccount(u)) {
		writeError(w, http.StatusNotFound, "not_found", "Пользователь не найден")
		return nil, false
	}
	if err != nil {
		s.keycloakError(w, err)
		return nil, false
	}
	return u, true
}

func (s *Server) userDetailFor(r *http.Request, u *keycloak.User) (userDetail, error) {
	sess := sessionFrom(r.Context())
	d := userDetail{
		directoryUser: s.directoryUserFor(r, u),
		Groups:        []string{},
		Self:          u.ID == sess.Claims.Subject,
	}
	groups, err := s.kc.UserGroups(r.Context(), u.ID)
	if err != nil {
		return d, err
	}
	for _, g := range groups {
		d.Groups = append(d.Groups, g.Path)
	}
	if !s.isAdmin(r) {
		return d, nil
	}
	ev := u.EmailVerified
	d.EmailVerified = &ev
	d.AttributeNames = s.directoryAttributes()
	if u.CreatedTimestamp > 0 {
		t := time.UnixMilli(u.CreatedTimestamp).UTC()
		d.CreatedAt = &t
	}
	roles, err := s.kc.UserRealmRoles(r.Context(), u.ID)
	if err != nil {
		return d, err
	}
	names := make([]string, 0, len(roles))
	for _, role := range roles {
		names = append(names, role.Name)
	}
	slices.Sort(names)
	d.Roles = displayRoles(names)
	ss, err := s.kc.UserSessions(r.Context(), u.ID)
	if err != nil {
		return d, err
	}
	current := ""
	if d.Self {
		current = sess.Claims.SessionID
	}
	d.Sessions = sessionViews(ss, current)
	cs, err := s.kc.UserCredentials(r.Context(), u.ID)
	if err != nil {
		return d, err
	}
	d.Credentials = credentialViews(cs)
	return d, nil
}

func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	u, ok := s.visibleUser(w, r)
	if !ok {
		return
	}
	d, err := s.userDetailFor(r, u)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

type adminUserUpdate struct {
	FirstName  *string           `json:"firstName"`
	LastName   *string           `json:"lastName"`
	Email      *string           `json:"email"`
	Enabled    *bool             `json:"enabled"`
	Attributes map[string]string `json:"attributes"`
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	var in adminUserUpdate
	if !decodeJSON(w, r, &in) {
		return
	}
	var errs []error
	if in.FirstName != nil {
		v, err := cleanText(*in.FirstName, 1, 100)
		errs = appendField(errs, "firstName", err)
		in.FirstName = &v
	}
	if in.LastName != nil {
		v, err := cleanText(*in.LastName, 1, 100)
		errs = appendField(errs, "lastName", err)
		in.LastName = &v
	}
	if in.Email != nil {
		v := strings.TrimSpace(*in.Email)
		if a, err := mail.ParseAddress(v); err != nil || a.Address != v || len(v) > 254 {
			errs = append(errs, errors.New("email: введите полный адрес, например name@company.ru"))
		}
		in.Email = &v
	}
	allowed := s.directoryAttributes()
	for name, value := range in.Attributes {
		if !slices.Contains(allowed, name) {
			errs = append(errs, fmt.Errorf("%s: поле нельзя изменять", name))
			continue
		}
		v, err := cleanText(value, 0, 255)
		errs = appendField(errs, name, err)
		in.Attributes[name] = v
	}
	if err := errors.Join(errs...); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", err.Error())
		return
	}

	u, ok := s.visibleUser(w, r)
	if !ok {
		return
	}
	actor := sessionFrom(r.Context()).Claims.Subject
	if in.Enabled != nil && !*in.Enabled && u.ID == actor {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Нельзя отключить собственную учётную запись")
		return
	}
	var changed []string
	if in.FirstName != nil && *in.FirstName != u.FirstName {
		u.FirstName = *in.FirstName
		changed = append(changed, "firstName")
	}
	if in.LastName != nil && *in.LastName != u.LastName {
		u.LastName = *in.LastName
		changed = append(changed, "lastName")
	}
	if in.Email != nil && !strings.EqualFold(*in.Email, u.Email) {
		u.Email = *in.Email
		// A new address has to be confirmed again.
		u.EmailVerified = false
		changed = append(changed, "email")
	}
	disabled := false
	if in.Enabled != nil && *in.Enabled != u.Enabled {
		u.Enabled = *in.Enabled
		disabled = !u.Enabled
		changed = append(changed, "enabled")
	}
	for name, value := range in.Attributes {
		if u.Attr(name) != value {
			u.SetAttr(name, value)
			changed = append(changed, name)
		}
	}
	if len(changed) > 0 {
		if err := s.kc.UpdateUser(r.Context(), u); err != nil {
			if errors.Is(err, keycloak.ErrConflict) {
				writeError(w, http.StatusConflict, "conflict", "Этот email уже занят другим пользователем")
				return
			}
			s.keycloakError(w, err)
			return
		}
		if disabled {
			// A disabled account should not keep working in open sessions.
			if err := s.kc.LogoutUser(r.Context(), u.ID); err != nil {
				s.log.Warn("logout disabled user", "sub", u.ID, "err", err)
			}
		}
		slices.Sort(changed)
		s.audit(r, actor, "admin.user.update", u.ID, map[string]any{"fields": changed})
	}
	d, err := s.userDetailFor(r, u)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleAdminLogoutUser(w http.ResponseWriter, r *http.Request) {
	u, ok := s.visibleUser(w, r)
	if !ok {
		return
	}
	if err := s.kc.LogoutUser(r.Context(), u.ID); err != nil {
		s.keycloakError(w, err)
		return
	}
	s.audit(r, sessionFrom(r.Context()).Claims.Subject, "admin.user.logout", u.ID, nil)
	w.WriteHeader(http.StatusNoContent)
}

// Required actions an administrator may email to a user.
var emailActions = map[string]bool{
	"UPDATE_PASSWORD": true,
	"VERIFY_EMAIL":    true,
	"CONFIGURE_TOTP":  true,
}

func (s *Server) handleAdminActionsEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Actions []string `json:"actions"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	slices.Sort(in.Actions)
	in.Actions = slices.Compact(in.Actions)
	if len(in.Actions) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Выберите хотя бы одно действие")
		return
	}
	for _, a := range in.Actions {
		if !emailActions[a] {
			writeError(w, http.StatusUnprocessableEntity, "validation", "Неподдерживаемое действие: "+a)
			return
		}
	}
	u, ok := s.visibleUser(w, r)
	if !ok {
		return
	}
	if u.Email == "" {
		writeError(w, http.StatusUnprocessableEntity, "validation", "У пользователя не указан email")
		return
	}
	if err := s.kc.ExecuteActionsEmail(r.Context(), u.ID, in.Actions); err != nil {
		s.log.Error("execute actions email", "sub", u.ID, "err", err)
		writeError(w, http.StatusBadGateway, "keycloak", "Keycloak не отправил письмо. Проверьте настройки почты (SMTP) в realm")
		return
	}
	s.audit(r, sessionFrom(r.Context()).Claims.Subject, "admin.user.actions_email", u.ID, map[string]any{"actions": in.Actions})
	w.WriteHeader(http.StatusNoContent)
}
