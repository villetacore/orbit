package api

import (
	"net/http"
	"slices"
	"testing"
)

func TestAccountSessions(t *testing.T) {
	h := newHarness(t)
	h.login()

	var out struct{ Sessions []sessionView }
	h.decode(h.do("GET", "/api/account/sessions", nil, nil), http.StatusOK, &out)
	if len(out.Sessions) != 2 || !out.Sessions[0].Current || out.Sessions[0].ID != "s-current" {
		t.Fatalf("sessions: %+v", out.Sessions)
	}

	// Someone else's session is indistinguishable from a missing one.
	if resp := h.write("DELETE", "/api/account/sessions/s-bob", nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("foreign session: %d", resp.StatusCode)
	}
	var ended map[string]int
	h.decode(h.write("POST", "/api/account/sessions/end-others", nil), http.StatusOK, &ended)
	if ended["ended"] != 1 {
		t.Fatalf("ended: %v", ended)
	}
	h.decode(h.do("GET", "/api/account/sessions", nil, nil), http.StatusOK, &out)
	if len(out.Sessions) != 1 || out.Sessions[0].ID != "s-current" {
		t.Fatalf("after end-others: %+v", out.Sessions)
	}
	if !slices.Contains(h.store.AuditActions(), "account.session.end_others") {
		t.Fatal("not audited")
	}
}

func TestAccountCredentials(t *testing.T) {
	h := newHarness(t)
	h.login()
	var out struct{ Credentials []credentialView }
	h.decode(h.do("GET", "/api/account/credentials", nil, nil), http.StatusOK, &out)
	if len(out.Credentials) != 2 || out.Credentials[0].Removable || !out.Credentials[1].Removable {
		t.Fatalf("credentials: %+v", out.Credentials)
	}
}

func TestDeleteCredentialAction(t *testing.T) {
	h := newHarness(t)
	resp := h.do("GET", "/auth/action/delete_credential:c-otp", nil, nil)
	if resp.StatusCode != http.StatusFound || h.oidc.lastExtra["kc_action"] != "delete_credential:c-otp" {
		t.Fatalf("status %d extra %v", resp.StatusCode, h.oidc.lastExtra)
	}
	if resp := h.do("GET", "/auth/action/delete_credential:a%26b", nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad id: %d", resp.StatusCode)
	}
}

func TestDirectoryHidesDisabledAndServiceAccounts(t *testing.T) {
	h := newHarness(t)
	h.login()
	var out struct {
		Users   []directoryUser
		HasMore bool
	}
	h.decode(h.do("GET", "/api/users", nil, nil), http.StatusOK, &out)
	var names []string
	for _, u := range out.Users {
		names = append(names, u.Username)
	}
	if !slices.Equal(names, []string{"alice", "bob"}) {
		t.Fatalf("users: %v", names)
	}
	for _, a := range out.Users[1].Attributes {
		if a.Name == "secret" {
			t.Fatal("unexposed attribute leaked")
		}
	}

	h.decode(h.do("GET", "/api/users?q=bob", nil, nil), http.StatusOK, &out)
	if len(out.Users) != 1 || out.Users[0].Sub != "user-2" {
		t.Fatalf("search: %+v", out.Users)
	}

	var d userDetail
	h.decode(h.do("GET", "/api/users/user-2", nil, nil), http.StatusOK, &d)
	if d.Sessions != nil || d.Roles != nil || len(d.Groups) != 1 {
		t.Fatalf("non-admin detail: %+v", d)
	}
	if resp := h.do("GET", "/api/users/user-3", nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("disabled user visible: %d", resp.StatusCode)
	}
	if resp := h.write("POST", "/api/admin/users/user-2/logout", nil); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin logout: %d", resp.StatusCode)
	}
}

func TestAdminManagesUsers(t *testing.T) {
	h := newHarness(t, "orbit-admin")
	h.login()

	var out struct{ Users []directoryUser }
	h.decode(h.do("GET", "/api/users", nil, nil), http.StatusOK, &out)
	if len(out.Users) != 4 {
		t.Fatalf("admin sees %d users", len(out.Users))
	}

	var d userDetail
	h.decode(h.do("GET", "/api/users/user-2", nil, nil), http.StatusOK, &d)
	if len(d.Sessions) != 1 || !slices.Equal(d.Roles, []string{"staff"}) || d.EmailVerified == nil {
		t.Fatalf("admin detail: %+v", d)
	}

	h.decode(h.write("PATCH", "/api/admin/users/user-2", map[string]any{
		"email": "robert@example.com", "enabled": false, "attributes": map[string]string{"department": "Ops"},
	}), http.StatusOK, &d)
	u := h.kc.users["user-2"]
	if u.Email != "robert@example.com" || u.EmailVerified || u.Enabled || u.Attr("department") != "Ops" || u.Attr("secret") != "x" {
		t.Fatalf("user after update: %+v", u)
	}
	if !slices.Contains(h.kc.logouts, "user-2") {
		t.Fatal("disabled user not logged out")
	}

	if resp := h.write("PATCH", "/api/admin/users/user-1", map[string]any{"enabled": false}); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("self-disable: %d", resp.StatusCode)
	}
	if resp := h.write("PATCH", "/api/admin/users/user-1", map[string]any{"email": "nope"}); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("bad email: %d", resp.StatusCode)
	}

	h.decode(h.write("POST", "/api/admin/users/user-1/actions-email", map[string]any{"actions": []string{"UPDATE_PASSWORD"}}), http.StatusNoContent, nil)
	if !slices.Equal(h.kc.emails["user-1"], []string{"UPDATE_PASSWORD"}) {
		t.Fatalf("emails: %v", h.kc.emails)
	}
	if resp := h.write("POST", "/api/admin/users/user-1/actions-email", map[string]any{"actions": []string{"DELETE_ACCOUNT"}}); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("bad action: %d", resp.StatusCode)
	}
	h.decode(h.write("POST", "/api/admin/users/user-1/logout", nil), http.StatusNoContent, nil)

	for _, a := range []string{"admin.user.update", "admin.user.actions_email", "admin.user.logout"} {
		if !slices.Contains(h.store.AuditActions(), a) {
			t.Fatalf("%s not audited", a)
		}
	}
}
