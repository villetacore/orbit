package api

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/villetacore/orbit/backend/internal/store"
)

var applicant = map[string]string{
	"username": "Dave.K", "email": "dave@example.com", "firstName": "Dave", "lastName": "K", "comment": "Новый сотрудник",
}

func TestRegisterDisabledByDefault(t *testing.T) {
	h := newHarness(t)
	if resp := h.write("POST", "/api/register", applicant); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("disabled registration: %d", resp.StatusCode)
	}
}

func TestRegisterValidatesAndHidesDuplicates(t *testing.T) {
	h := newHarness(t)
	h.cfg.RegistrationEnabled = true

	h.decode(h.write("POST", "/api/register", applicant), http.StatusAccepted, nil)
	// A second request for the same login gets the same answer but is not stored.
	h.decode(h.write("POST", "/api/register", applicant), http.StatusAccepted, nil)
	regs, _ := h.store.ListRegistrations(t.Context(), "", 10)
	if len(regs) != 1 || regs[0].Username != "dave.k" {
		t.Fatalf("registrations: %+v", regs)
	}

	bad := map[string]string{"username": "x", "email": "nope", "firstName": "", "lastName": "K"}
	if resp := h.write("POST", "/api/register", bad); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("invalid input: %d", resp.StatusCode)
	}
	bot := map[string]string{"username": "botty", "email": "b@example.com", "firstName": "B", "lastName": "B", "website": "x"}
	h.decode(h.write("POST", "/api/register", bot), http.StatusAccepted, nil)
	if n, _ := h.store.CountPendingRegistrations(t.Context()); n != 1 {
		t.Fatalf("honeypot request stored: %d pending", n)
	}
	resp := h.do("POST", "/api/register", strings.NewReader(`{}`), map[string]string{
		"Content-Type": "application/json", "Origin": "https://evil.test",
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", resp.StatusCode)
	}
}

func TestAdminApprovesRegistration(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.cfg.RegistrationEnabled = true
	h.decode(h.write("POST", "/api/register", applicant), http.StatusAccepted, nil)
	h.login()

	var list struct{ Registrations []store.Registration }
	h.decode(h.do("GET", "/api/admin/registrations?status=pending", nil, nil), http.StatusOK, &list)
	if len(list.Registrations) != 1 {
		t.Fatalf("pending: %+v", list.Registrations)
	}
	id := list.Registrations[0].ID

	var out approveResponse
	h.decode(h.write("POST", "/api/admin/registrations/1/approve", nil), http.StatusOK, &out)
	u := h.kc.users[out.UserSub]
	if u == nil || u.Username != "dave.k" || !u.Enabled || out.Delivery != "email" {
		t.Fatalf("approve: %+v user %+v", out, u)
	}
	if !slices.Equal(h.kc.emails[out.UserSub], []string{"UPDATE_PASSWORD", "VERIFY_EMAIL"}) {
		t.Fatalf("emails: %v", h.kc.emails)
	}
	if out.Registration.Status != store.RegistrationApproved || out.Registration.UserSub != out.UserSub {
		t.Fatalf("registration after approve: %+v", out.Registration)
	}
	if resp := h.write("POST", "/api/admin/registrations/1/reject", nil); resp.StatusCode != http.StatusConflict {
		t.Fatalf("decide twice: %d (id %d)", resp.StatusCode, id)
	}
	if !slices.Contains(h.store.AuditActions(), "admin.registration.approve") {
		t.Fatal("approval not audited")
	}
}

func TestApproveFallsBackToTemporaryPassword(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.cfg.RegistrationEnabled = true
	h.kc.emailErr = errors.New("smtp not configured")
	h.decode(h.write("POST", "/api/register", applicant), http.StatusAccepted, nil)
	h.login()

	var out approveResponse
	h.decode(h.write("POST", "/api/admin/registrations/1/approve", map[string]string{"delivery": "auto"}), http.StatusOK, &out)
	if out.Delivery != "password" || len(out.TemporaryPassword) != 20 || h.kc.passwords[out.UserSub] != out.TemporaryPassword {
		t.Fatalf("fallback: %+v", out)
	}
}

func TestRejectAndConflicts(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.cfg.RegistrationEnabled = true
	// "bob" already exists in Keycloak.
	h.decode(h.write("POST", "/api/register", map[string]string{
		"username": "bob", "email": "other@example.com", "firstName": "B", "lastName": "B",
	}), http.StatusAccepted, nil)
	h.login()
	if resp := h.write("POST", "/api/admin/registrations/1/approve", nil); resp.StatusCode != http.StatusConflict {
		t.Fatalf("existing user: %d", resp.StatusCode)
	}
	h.decode(h.write("POST", "/api/admin/registrations/1/reject", nil), http.StatusNoContent, nil)
	r, _ := h.store.GetRegistration(t.Context(), 1)
	if r.Status != store.RegistrationRejected {
		t.Fatalf("status %s", r.Status)
	}
}

func TestRegistrationsAdminOnly(t *testing.T) {
	h := newHarness(t)
	h.login()
	if resp := h.do("GET", "/api/admin/registrations", nil, nil); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin list: %d", resp.StatusCode)
	}
}

func TestTemporaryPassword(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		p := temporaryPassword()
		if len(p) != 20 || p[6] != '-' || p[13] != '-' || seen[p] {
			t.Fatalf("bad password %q", p)
		}
		seen[p] = true
	}
}
