package auth

import (
	"errors"
	"net/http"
	"testing"
)

func TestPasswordGrantError(t *testing.T) {
	cases := []struct {
		code, description string
		want              error
	}{
		{"invalid_grant", "Invalid user credentials", ErrInvalidCredentials},
		{"invalid_grant", "Account disabled", ErrAccountDisabled},
		{"invalid_grant", "Account is not fully set up", ErrAccountSetup},
		{"unauthorized_client", "Client not allowed for direct access grants", ErrPasswordGrantDisabled},
	}
	for _, c := range cases {
		if got := passwordGrantError(http.StatusBadRequest, c.code, c.description); !errors.Is(got, c.want) {
			t.Errorf("%s/%s: %v", c.code, c.description, got)
		}
	}
	// An outage must not look like a wrong password.
	if got := passwordGrantError(http.StatusInternalServerError, "server_error", ""); errors.Is(got, ErrInvalidCredentials) {
		t.Errorf("server error: %v", got)
	}
}
