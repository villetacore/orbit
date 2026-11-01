// Package catalog holds service visibility rules and input validation.
// Visibility is enforced on the server; the frontend only renders what it gets.
package catalog

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/villetacore/orbit/backend/internal/store"
)

// VisibleTo reports whether a user with the given roles may see and launch s.
// Hidden services are visible to nobody; an empty RequiredRoles list means
// every authenticated user; otherwise any one of the roles is enough.
func VisibleTo(s store.Service, roles []string) bool {
	if s.Status == store.StatusHidden {
		return false
	}
	if len(s.RequiredRoles) == 0 {
		return true
	}
	for _, r := range s.RequiredRoles {
		if slices.Contains(roles, r) {
			return true
		}
	}
	return false
}

var (
	slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,49}$`)
	rolePattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,100}$`)
)

// Normalize trims input fields, applies defaults and validates the result.
func Normalize(in store.ServiceInput) (store.ServiceInput, error) {
	in.Slug = strings.TrimSpace(in.Slug)
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	in.URL = strings.TrimSpace(in.URL)
	in.IconURL = strings.TrimSpace(in.IconURL)
	in.Category = strings.TrimSpace(in.Category)
	if in.Status == "" {
		in.Status = store.StatusActive
	}
	roles := []string{}
	for _, r := range in.RequiredRoles {
		if r = strings.TrimSpace(r); r != "" && !slices.Contains(roles, r) {
			roles = append(roles, r)
		}
	}
	in.RequiredRoles = roles

	var errs []error
	if !slugPattern.MatchString(in.Slug) {
		errs = append(errs, errors.New("slug: 2-50 lowercase letters, digits or dashes"))
	}
	if n := utf8.RuneCountInString(in.Name); n < 1 || n > 100 {
		errs = append(errs, errors.New("name: 1-100 characters"))
	}
	if utf8.RuneCountInString(in.Description) > 500 {
		errs = append(errs, errors.New("description: at most 500 characters"))
	}
	if utf8.RuneCountInString(in.Category) > 50 {
		errs = append(errs, errors.New("category: at most 50 characters"))
	}
	if err := ValidateURL(in.URL); err != nil {
		errs = append(errs, fmt.Errorf("url: %w", err))
	}
	if in.IconURL != "" {
		if err := ValidateURL(in.IconURL); err != nil {
			errs = append(errs, fmt.Errorf("iconUrl: %w", err))
		}
	}
	switch in.Status {
	case store.StatusActive, store.StatusMaintenance, store.StatusHidden:
	default:
		errs = append(errs, errors.New("status: active, maintenance or hidden"))
	}
	for _, r := range in.RequiredRoles {
		if !rolePattern.MatchString(r) {
			errs = append(errs, fmt.Errorf("requiredRoles: invalid role %q", r))
		}
	}
	if in.SortOrder < -10000 || in.SortOrder > 10000 {
		errs = append(errs, errors.New("sortOrder: between -10000 and 10000"))
	}
	return in, errors.Join(errs...)
}

// ValidateURL accepts only absolute http(s) URLs, which rules out
// javascript:, data: and similar schemes in links rendered by the frontend.
func ValidateURL(raw string) error {
	if len(raw) > 2048 {
		return errors.New("too long")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return errors.New("malformed")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("must use http or https")
	}
	if u.Host == "" {
		return errors.New("must be absolute")
	}
	if u.User != nil {
		return errors.New("must not contain credentials")
	}
	return nil
}
