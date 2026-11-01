package api

import (
	"crypto/rand"
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/villetacore/orbit/backend/internal/keycloak"
	"github.com/villetacore/orbit/backend/internal/store"
)

// Self-service sign-up. Anyone may file a request when
// ORBIT_REGISTRATION_ENABLED is on; the request lives only in Orbit until an
// administrator approves it, and only then is the Keycloak user created. The
// new user sets a password through a Keycloak email link or, when the realm
// cannot send mail, with a one-time temporary password shown to the
// administrator once. Orbit never stores passwords.

const maxPendingRegistrations = 500

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,31}$`)

type registerRequest struct {
	Username  string `json:"username"`
	Email     string `json:"email"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Comment   string `json:"comment"`
	// Website is a honeypot: people never see the field, simple bots fill it.
	Website string `json:"website"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.RegistrationEnabled {
		writeError(w, http.StatusNotFound, "not_found", "Регистрация отключена")
		return
	}
	// The JSON content type forces a CORS preflight, so other sites cannot
	// post here from a plain form; the Origin check covers the rest.
	if o := r.Header.Get("Origin"); o != "" && o != s.cfg.PublicURL {
		writeError(w, http.StatusForbidden, "bad_origin", "Запрос с недопустимого источника")
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "bad_request", "Ожидается application/json")
		return
	}
	var in registerRequest
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Website != "" {
		writeJSON(w, http.StatusAccepted, registerAccepted)
		return
	}

	var errs []error
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	if !usernamePattern.MatchString(in.Username) || strings.HasPrefix(in.Username, "service-account-") {
		errs = append(errs, errors.New("username: 3–32 символа: латиница, цифры, точка, дефис, подчёркивание"))
	}
	in.Email = strings.TrimSpace(in.Email)
	if a, err := mail.ParseAddress(in.Email); err != nil || a.Address != in.Email || len(in.Email) > 254 {
		errs = append(errs, errors.New("email: введите полный адрес, например name@company.ru"))
	}
	var err error
	in.FirstName, err = cleanText(in.FirstName, 1, 100)
	errs = appendField(errs, "firstName", err)
	in.LastName, err = cleanText(in.LastName, 1, 100)
	errs = appendField(errs, "lastName", err)
	in.Comment, err = cleanText(in.Comment, 0, 500)
	errs = appendField(errs, "comment", err)
	if err := errors.Join(errs...); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", err.Error())
		return
	}

	ctx := r.Context()
	if n, err := s.store.CountPendingRegistrations(ctx); err != nil {
		s.internalError(w, "count registrations", err)
		return
	} else if n >= maxPendingRegistrations {
		writeError(w, http.StatusServiceUnavailable, "too_many", "Сейчас заявки не принимаются. Попробуйте позже")
		return
	}
	reg, err := s.store.CreateRegistration(ctx, store.Registration{
		Username: in.Username, Email: in.Email, FirstName: in.FirstName, LastName: in.LastName,
		Comment: in.Comment, IP: clientIP(r),
	})
	switch {
	case errors.Is(err, store.ErrConflict):
		// Same answer as success: the form must not reveal who already applied.
	case err != nil:
		s.internalError(w, "create registration", err)
		return
	default:
		s.audit(r, "", "registration.create", "registration:"+strconv.FormatInt(reg.ID, 10), nil)
	}
	writeJSON(w, http.StatusAccepted, registerAccepted)
}

// registerAccepted is the only answer a valid request gets, whatever happened.
var registerAccepted = map[string]string{"status": "pending"}

func (s *Server) handleAdminListRegistrations(w http.ResponseWriter, r *http.Request) {
	status := store.RegistrationStatus(r.URL.Query().Get("status"))
	switch status {
	case "", store.RegistrationPending, store.RegistrationApproved, store.RegistrationRejected:
	default:
		writeError(w, http.StatusBadRequest, "bad_request", "Неизвестный статус")
		return
	}
	regs, err := s.store.ListRegistrations(r.Context(), status, 200)
	if err != nil {
		s.internalError(w, "list registrations", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"registrations": regs})
}

// pendingRegistration loads the request from the URL and checks it is open.
func (s *Server) pendingRegistration(w http.ResponseWriter, r *http.Request) (*store.Registration, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Заявка не найдена")
		return nil, false
	}
	reg, err := s.store.GetRegistration(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Заявка не найдена")
		return nil, false
	}
	if err != nil {
		s.internalError(w, "get registration", err)
		return nil, false
	}
	if reg.Status != store.RegistrationPending {
		writeError(w, http.StatusConflict, "decided", "Заявка уже рассмотрена")
		return nil, false
	}
	return reg, true
}

type approveResponse struct {
	Registration *store.Registration `json:"registration"`
	UserSub      string              `json:"userSub"`
	// Delivery is how the user gets a password: "email" (Keycloak link),
	// "password" (TemporaryPassword, shown once) or "none" (both failed).
	Delivery          string `json:"delivery"`
	TemporaryPassword string `json:"temporaryPassword,omitempty"`
}

func (s *Server) handleAdminApproveRegistration(w http.ResponseWriter, r *http.Request) {
	var in struct {
		// "auto" tries the email link first; "password" skips it.
		Delivery string `json:"delivery"`
	}
	if r.ContentLength != 0 && !decodeJSON(w, r, &in) {
		return
	}
	if in.Delivery != "" && in.Delivery != "auto" && in.Delivery != "password" {
		writeError(w, http.StatusUnprocessableEntity, "validation", "Неизвестный способ выдачи пароля")
		return
	}
	reg, ok := s.pendingRegistration(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	actor := sessionFrom(ctx).Claims.Subject
	sub, err := s.kc.CreateUser(ctx, &keycloak.User{
		Username: reg.Username, Email: reg.Email, FirstName: reg.FirstName, LastName: reg.LastName, Enabled: true,
	})
	if errors.Is(err, keycloak.ErrConflict) {
		writeError(w, http.StatusConflict, "conflict", "Логин или email уже заняты в Keycloak. Отклоните заявку или свяжитесь с заявителем")
		return
	}
	if err != nil {
		s.keycloakError(w, err)
		return
	}
	if err := s.store.DecideRegistration(ctx, reg.ID, store.RegistrationApproved, actor, sub); err != nil {
		s.log.Error("record approval", "registration", reg.ID, "sub", sub, "err", err)
	}

	resp := approveResponse{UserSub: sub, Delivery: "none"}
	if in.Delivery != "password" {
		if err := s.kc.ExecuteActionsEmail(ctx, sub, []string{"UPDATE_PASSWORD", "VERIFY_EMAIL"}); err != nil {
			s.log.Warn("registration email", "sub", sub, "err", err)
		} else {
			resp.Delivery = "email"
		}
	}
	if resp.Delivery == "none" {
		pw := temporaryPassword()
		if err := s.kc.SetPassword(ctx, sub, pw, true); err != nil {
			s.log.Error("set temporary password", "sub", sub, "err", err)
		} else {
			resp.Delivery, resp.TemporaryPassword = "password", pw
		}
	}
	s.audit(r, actor, "admin.registration.approve", sub, map[string]any{
		"registration": reg.ID, "username": reg.Username, "delivery": resp.Delivery,
	})
	resp.Registration, _ = s.store.GetRegistration(ctx, reg.ID)
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleAdminRejectRegistration(w http.ResponseWriter, r *http.Request) {
	reg, ok := s.pendingRegistration(w, r)
	if !ok {
		return
	}
	actor := sessionFrom(r.Context()).Claims.Subject
	err := s.store.DecideRegistration(r.Context(), reg.ID, store.RegistrationRejected, actor, "")
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "decided", "Заявка уже рассмотрена")
		return
	}
	if err != nil {
		s.internalError(w, "reject registration", err)
		return
	}
	s.audit(r, actor, "admin.registration.reject", "registration:"+strconv.FormatInt(reg.ID, 10), map[string]any{"username": reg.Username})
	w.WriteHeader(http.StatusNoContent)
}

// temporaryPassword returns 18 random characters in three groups, with an
// upper-case letter, a lower-case letter and a digit, so common Keycloak
// password policies accept it. Ambiguous characters (0/O, 1/l/I) are left out.
func temporaryPassword() string {
	const (
		upper  = "ABCDEFGHJKLMNPQRSTUVWXYZ"
		lower  = "abcdefghijkmnopqrstuvwxyz"
		digits = "23456789"
	)
	all := upper + lower + digits
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	out := make([]byte, 0, 20)
	for i, v := range b {
		set := all
		switch i {
		case 0:
			set = upper
		case 7:
			set = lower
		case 14:
			set = digits
		}
		if i == 6 || i == 12 {
			out = append(out, '-')
		}
		out = append(out, set[int(v)%len(set)])
	}
	return string(out)
}
