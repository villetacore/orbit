// Package totp generates and checks RFC 6238 one-time passwords the way
// Keycloak does, so a secret enrolled in Orbit keeps working in Keycloak.
package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // HMAC-SHA1 is what RFC 6238 and authenticator apps use
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"hash"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Params mirror a Keycloak realm's OTP policy.
type Params struct {
	Digits    int
	Period    int
	Algorithm string // HmacSHA1, HmacSHA256 or HmacSHA512
}

// Supported reports whether Orbit can enroll credentials with these parameters.
func (p Params) Supported() bool {
	return p.Digits >= 6 && p.Digits <= 8 && p.Period > 0 && p.newHash() != nil
}

func (p Params) newHash() func() hash.Hash {
	switch p.Algorithm {
	case "HmacSHA1":
		return sha1.New
	case "HmacSHA256":
		return sha256.New
	case "HmacSHA512":
		return sha512.New
	}
	return nil
}

const secretAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// NewSecret returns a random secret in Keycloak's format: 20 alphanumeric
// characters, whose bytes are the HMAC key.
func NewSecret() string {
	b := make([]byte, 20)
	_, _ = rand.Read(b) // crypto/rand.Read never fails on supported platforms.
	for i, v := range b {
		// 248 is the largest multiple of 62 below 256; re-rolling removes bias.
		for v >= 248 {
			var one [1]byte
			_, _ = rand.Read(one[:])
			v = one[0]
		}
		b[i] = secretAlphabet[int(v)%len(secretAlphabet)]
	}
	return string(b)
}

// EncodeSecret is the Base32 form shown to people and authenticator apps.
func EncodeSecret(secret string) string {
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte(secret))
}

// URI builds the otpauth:// link encoded in the enrollment QR code.
func URI(p Params, secret, issuer, account string) string {
	q := url.Values{
		"secret":    {EncodeSecret(secret)},
		"issuer":    {issuer},
		"algorithm": {strings.TrimPrefix(p.Algorithm, "Hmac")},
		"digits":    {strconv.Itoa(p.Digits)},
		"period":    {strconv.Itoa(p.Period)},
	}
	label := url.PathEscape(issuer) + ":" + url.PathEscape(account)
	return fmt.Sprintf("otpauth://totp/%s?%s", label, q.Encode())
}

// Code computes the one-time password for the time step containing t.
func Code(p Params, secret string, t time.Time) string {
	mac := hmac.New(p.newHash(), []byte(secret))
	_ = binary.Write(mac, binary.BigEndian, uint64(t.Unix()/int64(p.Period)))
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	v := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	mod := uint32(1)
	for range p.Digits {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", p.Digits, v%mod)
}

// Verify accepts a code for the current time step or one neighbor on each side
// plus lookAhead more, tolerating clock drift like Keycloak does.
func Verify(p Params, secret, code string, now time.Time, lookAhead int) bool {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	window := max(lookAhead, 1)
	for i := -window; i <= window; i++ {
		c := Code(p, secret, now.Add(time.Duration(i*p.Period)*time.Second))
		if subtle.ConstantTimeCompare([]byte(c), []byte(code)) == 1 {
			return true
		}
	}
	return false
}
