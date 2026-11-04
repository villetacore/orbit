package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/villetacore/orbit/backend/internal/keycloak"
)

// Realm administration from Orbit: an authenticated pass-through to Keycloak's
// Admin REST API for the managed realm, so every setting Keycloak has is
// reachable without its console. Requests run as Orbit's service account after
// requireAdmin and requireCSRF; every write is audited. Bodies are never logged:
// they can hold client secrets and passwords.

const maxKeycloakBody = 4 << 20

// keycloakResources are the realm sub-resources the pass-through forwards. Only
// the realm itself is special-cased: it can be read and updated, not deleted.
var keycloakResources = map[string]bool{
	"admin-events": true, "attack-detection": true, "authentication": true, "client-policies": true,
	"client-registration-policy": true, "client-scopes": true, "client-session-stats": true, "clients": true,
	"clients-initial-access": true, "components": true, "default-default-client-scopes": true,
	"default-groups": true, "default-optional-client-scopes": true, "events": true, "groups": true,
	"identity-provider": true, "keys": true, "localization": true, "logout-all": true, "organizations": true,
	"partial-export": true, "partialImport": true, "push-revocation": true, "roles": true, "roles-by-id": true,
	"sessions": true, "testSMTPConnection": true, "users": true, "users-management-permissions": true,
}

// keycloakPath splits a request path below /api/admin/keycloak into validated
// segments. Encoded separators and dot segments are rejected so a request cannot
// climb out of the realm, e.g. into another realm or the master realm.
func keycloakPath(escaped string) ([]string, bool) {
	rest := strings.Trim(strings.TrimPrefix(escaped, "/api/admin/keycloak"), "/")
	if rest == "" {
		return nil, true
	}
	segs := strings.Split(rest, "/")
	for _, raw := range segs {
		seg, err := url.PathUnescape(raw)
		if err != nil || seg == "" || seg == "." || seg == ".." || strings.ContainsAny(seg, "/\\\x00") {
			return nil, false
		}
	}
	return segs, keycloakResources[segs[0]]
}

func (s *Server) handleKeycloakProxy(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		writeError(w, http.StatusMethodNotAllowed, "bad_method", "Метод не поддерживается")
		return
	}
	segs, ok := keycloakPath(r.URL.EscapedPath())
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Ресурс Keycloak не найден")
		return
	}
	var body []byte
	if !isSafeMethod(r.Method) {
		var err error
		body, err = io.ReadAll(http.MaxBytesReader(w, r.Body, maxKeycloakBody))
		if err != nil {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "Слишком большой запрос")
			return
		}
		if msg := s.keycloakLockoutGuard(r, segs, body); msg != "" {
			writeError(w, http.StatusConflict, "lockout_guard", msg)
			return
		}
	}
	path := s.kc.RealmPath()
	if len(segs) > 0 {
		path += "/" + strings.Join(segs, "/")
	}
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	resp, err := s.kc.Raw(r.Context(), r.Method, path, body, contentType)
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	if !isSafeMethod(r.Method) && resp.Status < 300 {
		s.audit(r, sessionFrom(r.Context()).Claims.Subject, "admin.keycloak."+strings.ToLower(r.Method), "/"+strings.Join(segs, "/"), nil)
	}
	s.writeRaw(w, resp)
}

// handleKeycloakServerInfo exposes the provider catalog (password policies,
// themes, protocol mappers...) the settings screens choose from.
func (s *Server) handleKeycloakServerInfo(w http.ResponseWriter, r *http.Request) {
	resp, err := s.kc.Raw(r.Context(), http.MethodGet, "/admin/serverinfo", nil, "")
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	s.writeRaw(w, resp)
}

// writeRaw relays a Keycloak answer, translating failures into Orbit's error
// format so the frontend shows them like any other API error.
func (s *Server) writeRaw(w http.ResponseWriter, resp *keycloak.RawResponse) {
	if resp.Status >= 300 {
		ke := keycloak.NewError(resp.Status, resp.Body)
		switch resp.Status {
		case http.StatusNotFound:
			writeError(w, resp.Status, "not_found", "Не найдено в Keycloak: "+ke.Message)
		case http.StatusConflict:
			writeError(w, resp.Status, "conflict", ke.Message)
		case http.StatusForbidden:
			s.keycloakError(w, ke)
		default:
			if resp.Status >= 500 {
				s.log.Error("keycloak admin", "status", resp.Status, "message", ke.Message)
				writeError(w, http.StatusBadGateway, "keycloak", "Ошибка Keycloak: "+ke.Message)
				return
			}
			writeError(w, resp.Status, "keycloak", ke.Message)
		}
		return
	}
	if resp.Location != "" {
		// Lets the caller learn the new object's ID, the last path segment.
		w.Header().Set("X-Created-Id", resp.Location[strings.LastIndex(resp.Location, "/")+1:])
	}
	if resp.ContentType != "" {
		w.Header().Set("Content-Type", resp.ContentType)
	}
	w.WriteHeader(resp.Status)
	_, _ = w.Write(resp.Body)
}

// keycloakLockoutGuard refuses the few writes that would cut Orbit or the acting
// administrator off from the realm, because they could not be undone from here.
// It returns the reason, or "". This protects against accidents; administrators
// are trusted, and can still do these things in the Keycloak console.
func (s *Server) keycloakLockoutGuard(r *http.Request, segs []string, body []byte) string {
	var rep map[string]any
	_ = json.Unmarshal(body, &rep)
	disabling := func(field string) bool {
		v, present := rep[field].(bool)
		return present && !v
	}
	if len(segs) == 0 {
		if r.Method != http.MethodPut {
			return "Realm нельзя удалить из Orbit"
		}
		if disabling("enabled") {
			return "Нельзя отключить realm, в котором работает Orbit"
		}
		return ""
	}
	switch segs[0] {
	case "roles":
		if len(segs) == 2 && segs[1] == s.cfg.AdminRole && (r.Method == http.MethodDelete || r.Method == http.MethodPut) {
			return "Роль " + s.cfg.AdminRole + " даёт доступ к администрированию Orbit: её нельзя удалить или переименовать"
		}
	case "clients":
		if len(segs) >= 2 {
			return s.clientLockoutGuard(r, segs, disabling)
		}
	case "users":
		if len(segs) >= 2 {
			return s.userLockoutGuard(r, segs, body, disabling)
		}
	}
	return ""
}

func (s *Server) clientLockoutGuard(r *http.Request, segs []string, disabling func(string) bool) string {
	guarded := r.Method == http.MethodDelete && len(segs) == 2 ||
		r.Method == http.MethodPut && len(segs) == 2 ||
		r.Method == http.MethodPost && len(segs) == 3 && segs[2] == "client-secret"
	if !guarded {
		return ""
	}
	resp, err := s.kc.Raw(r.Context(), http.MethodGet, s.kc.RealmPath()+"/clients/"+segs[1], nil, "")
	if err != nil || resp.Status != http.StatusOK {
		return "" // Keycloak answers the real request with the real error.
	}
	var c struct {
		ClientID string `json:"clientId"`
	}
	if json.Unmarshal(resp.Body, &c) != nil || c.ClientID != s.cfg.ClientID && c.ClientID != s.cfg.AdminClientID {
		return ""
	}
	switch {
	case r.Method == http.MethodDelete:
		return "Клиент " + c.ClientID + " нужен для работы Orbit: его нельзя удалить"
	case r.Method == http.MethodPost:
		return "Новый секрет клиента " + c.ClientID + " сразу сломает Orbit. Смените его в консоли Keycloak вместе с настройками Orbit"
	case disabling("enabled"),
		c.ClientID == s.cfg.ClientID && disabling("directAccessGrantsEnabled"),
		c.ClientID == s.cfg.AdminClientID && disabling("serviceAccountsEnabled"):
		return "Эти настройки клиента " + c.ClientID + " нужны для работы Orbit: их нельзя отключить"
	}
	return ""
}

func (s *Server) userLockoutGuard(r *http.Request, segs []string, body []byte, disabling func(string) bool) string {
	self := segs[1] == sessionFrom(r.Context()).Claims.Subject
	onUser := len(segs) == 2 && (r.Method == http.MethodDelete || r.Method == http.MethodPut && disabling("enabled"))
	onRoles := len(segs) >= 3 && segs[2] == "role-mappings" && r.Method == http.MethodDelete
	if !onUser && !onRoles {
		return ""
	}
	if self && onUser {
		return "Нельзя удалить или отключить собственную учётную запись"
	}
	if self && onRoles {
		var roles []struct {
			Name string `json:"name"`
		}
		_ = json.Unmarshal(body, &roles)
		if slices.ContainsFunc(roles, func(role struct {
			Name string `json:"name"`
		}) bool {
			return role.Name == s.cfg.AdminRole
		}) {
			return "Нельзя снять с себя роль " + s.cfg.AdminRole
		}
	}
	u, err := s.kc.GetUser(r.Context(), segs[1])
	if err != nil {
		if !errors.Is(err, keycloak.ErrNotFound) {
			s.log.Warn("lockout guard: load user", "err", err)
		}
		return ""
	}
	if u.ServiceAccountClientID == s.cfg.AdminClientID {
		return "Сервисный аккаунт Orbit нельзя удалить, отключить или лишить ролей"
	}
	return ""
}
