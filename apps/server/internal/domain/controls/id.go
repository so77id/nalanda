package controls

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
)

// idEncoding is base32 without padding. 128 bits of randomness fit in 26
// characters, which is the shape a ULID advertises
// (https://github.com/ulid/spec). It is not a literal ULID: the timestamp
// half is dropped and the alphabet is the standard base32's, both because a
// direct dependency on a ULID library is a PR discussion in this repo (root
// CLAUDE.md) and because a control already carries its own timestamp
// (CreatedAt); duplicating it in the id has no reader.
var idEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewID returns a 26-character URL-safe identifier. 128 bits of randomness
// is well beyond what a professor's catalog will ever collide over, and the
// alphabet — [A-Z2-7], no padding — is safe in every URL segment this
// server serves.
//
// crypto/rand cannot return a short read without an error (documented on
// the package), so the length is guaranteed by construction — no retry loop
// is needed and none should be added.
func NewID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("controls.NewID: %w", err)
	}
	return idEncoding.EncodeToString(b[:]), nil
}

// IDLength is what a valid id measures. Callers that parse a path segment
// check against this rather than a magic number.
const IDLength = 26
