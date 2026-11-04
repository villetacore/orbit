package totp

import (
	"strings"
	"testing"
	"time"
)

// RFC 6238 appendix B test vectors (SHA-1, 8 digits, 30 seconds).
func TestCodeRFC6238(t *testing.T) {
	p := Params{Digits: 8, Period: 30, Algorithm: "HmacSHA1"}
	const secret = "12345678901234567890"
	for unix, want := range map[int64]string{59: "94287082", 1111111109: "07081804", 2000000000: "69279037"} {
		if got := Code(p, secret, time.Unix(unix, 0)); got != want {
			t.Errorf("t=%d: got %s, want %s", unix, got, want)
		}
	}
}

func TestVerifyWindow(t *testing.T) {
	p := Params{Digits: 6, Period: 30, Algorithm: "HmacSHA256"}
	secret := NewSecret()
	now := time.Unix(1_700_000_000, 0)
	if !Verify(p, secret, Code(p, secret, now.Add(-30*time.Second)), now, 1) {
		t.Error("previous step rejected")
	}
	if Verify(p, secret, Code(p, secret, now.Add(-5*time.Minute)), now, 1) {
		t.Error("stale code accepted")
	}
	if Verify(p, secret, "", now, 1) {
		t.Error("empty code accepted")
	}
}

func TestNewSecretAndURI(t *testing.T) {
	s := NewSecret()
	if len(s) != 20 || strings.Trim(s, secretAlphabet) != "" {
		t.Fatalf("secret %q", s)
	}
	uri := URI(Params{Digits: 6, Period: 30, Algorithm: "HmacSHA1"}, "abc", "Acme Co", "alice")
	for _, want := range []string{"otpauth://totp/Acme%20Co:alice?", "secret=MFRGG", "algorithm=SHA1", "issuer=Acme+Co"} {
		if !strings.Contains(uri, want) {
			t.Errorf("%s lacks %s", uri, want)
		}
	}
	if (Params{Digits: 6, Period: 30, Algorithm: "MD5"}).Supported() {
		t.Error("unknown algorithm supported")
	}
}
