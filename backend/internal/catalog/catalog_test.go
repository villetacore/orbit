package catalog

import (
	"testing"

	"github.com/villetacore/orbit/backend/internal/store"
)

func TestVisibleTo(t *testing.T) {
	cases := []struct {
		name  string
		svc   store.Service
		roles []string
		want  bool
	}{
		{"public", store.Service{Status: store.StatusActive}, nil, true},
		{"maintenance stays visible", store.Service{Status: store.StatusMaintenance}, nil, true},
		{"hidden", store.Service{Status: store.StatusHidden}, []string{"orbit-admin"}, false},
		{"role match", store.Service{Status: store.StatusActive, RequiredRoles: []string{"a", "b"}}, []string{"b"}, true},
		{"role mismatch", store.Service{Status: store.StatusActive, RequiredRoles: []string{"a"}}, []string{"c"}, false},
	}
	for _, c := range cases {
		if got := VisibleTo(c.svc, c.roles); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}

func TestNormalize(t *testing.T) {
	in := store.ServiceInput{Slug: " wiki ", Name: " Wiki ", URL: "https://wiki.test", RequiredRoles: []string{"", "a", "a"}}
	out, err := Normalize(in)
	if err != nil {
		t.Fatal(err)
	}
	if out.Slug != "wiki" || out.Name != "Wiki" || out.Status != store.StatusActive || len(out.RequiredRoles) != 1 {
		t.Fatalf("%+v", out)
	}

	for _, u := range []string{"javascript:alert(1)", "data:text/html,x", "//wiki.test", "https://user:pw@wiki.test", "ftp://x"} {
		if _, err := Normalize(store.ServiceInput{Slug: "x1", Name: "X", URL: u}); err == nil {
			t.Errorf("url %q accepted", u)
		}
	}
	if _, err := Normalize(store.ServiceInput{Slug: "Bad Slug", Name: "X", URL: "https://x.test"}); err == nil {
		t.Error("bad slug accepted")
	}
	if _, err := Normalize(store.ServiceInput{Slug: "x1", Name: "X", URL: "https://x.test", Status: "deleted"}); err == nil {
		t.Error("bad status accepted")
	}
}
