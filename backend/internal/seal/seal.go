// Package seal provides authenticated encryption for server-side secrets
// (session payloads, OAuth state) and random token helpers.
package seal

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
)

var ErrInvalid = errors.New("seal: invalid ciphertext")

type Sealer struct {
	aead cipher.AEAD
}

// New derives an AES-256-GCM key from secret.
func New(secret string) (*Sealer, error) {
	if len(secret) < 32 {
		return nil, errors.New("seal: secret must be at least 32 characters")
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Sealer{aead: aead}, nil
}

// Seal encrypts plain, binding it to aad, and returns a URL-safe string.
func (s *Sealer) Seal(plain, aad []byte) string {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(s.aead.Seal(nonce, nonce, plain, aad))
}

func (s *Sealer) Open(sealed string, aad []byte) ([]byte, error) {
	raw, err := base64.RawURLEncoding.DecodeString(sealed)
	if err != nil || len(raw) < s.aead.NonceSize() {
		return nil, ErrInvalid
	}
	n := s.aead.NonceSize()
	plain, err := s.aead.Open(nil, raw[:n], raw[n:], aad)
	if err != nil {
		return nil, ErrInvalid
	}
	return plain, nil
}

// RandomToken returns n random bytes encoded as base64url.
func RandomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Hash returns the hex SHA-256 of s; used to store lookup keys instead of raw tokens.
func Hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
