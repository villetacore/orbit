package seal

import (
	"strings"
	"testing"
)

func TestSealRoundTrip(t *testing.T) {
	s, err := New(strings.Repeat("x", 32))
	if err != nil {
		t.Fatal(err)
	}
	sealed := s.Seal([]byte("secret"), []byte("aad"))
	got, err := s.Open(sealed, []byte("aad"))
	if err != nil || string(got) != "secret" {
		t.Fatalf("%q %v", got, err)
	}
	if _, err := s.Open(sealed, []byte("other")); err == nil {
		t.Fatal("opened with wrong aad")
	}
	tampered := sealed[:len(sealed)-2] + "AA"
	if _, err := s.Open(tampered, []byte("aad")); err == nil {
		t.Fatal("opened tampered ciphertext")
	}
	other, _ := New(strings.Repeat("y", 32))
	if _, err := other.Open(sealed, []byte("aad")); err == nil {
		t.Fatal("opened with another key")
	}
}

func TestNewRejectsShortSecret(t *testing.T) {
	if _, err := New("short"); err == nil {
		t.Fatal("short secret accepted")
	}
}
