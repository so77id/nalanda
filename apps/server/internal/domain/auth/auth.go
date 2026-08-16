// Package auth is the professor user system of ADR-0009: who may log in, the
// Google identity that proves it, and the server-side session that carries it
// between requests.
//
// It is one package rather than the four DocumentBuddy splits this port from
// (auth, auth/session, auth/identity, and two more). That split earns its keep
// there because invitations, Telegram links and impersonation live beside these
// types; #150 ports none of them, and what is left is three types and a handful
// of functions that would only stutter as session.Session and identity.Identity.
//
// Everything here is standard library, which the architecture test enforces
// rather than hopes for: the stores and the OAuth provider are interfaces
// declared where they are consumed, and internal/infra implements them.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// ErrNotFound is what a store returns when the row is simply not there, so that
// a caller can tell "this cookie names no session" from "the database is
// unreachable" without importing database/sql to ask.
//
// The distinction is not academic: the first is a normal logged-out request and
// the second must never be treated as one, or a database blip logs every
// professor out at once.
var ErrNotFound = errors.New("auth: not found")

// tokenBytes is how many random bytes a session or CSRF token carries, before
// hex encoding doubles the length.
const tokenBytes = 32

// User is a professor. ADR-0009 admits no other kind of account: students read
// the course anonymously and join a session with a code.
type User struct {
	ID            int64
	Email         string
	Name          string
	IsActive      bool
	CreatedAt     time.Time
	DeactivatedAt *time.Time
}

// MayLogIn reports whether this professor is allowed to hold a session. The zero
// User cannot, which is what makes a forgotten error check fail closed.
func (u User) MayLogIn() bool {
	return u.ID != 0 && u.IsActive
}

// Identity is a (provider, subject) pair owned by a professor: the stable login
// key. Email is metadata here, not the key — Google lets an account holder
// change their address, and an email-keyed login would either lock them out or
// hand their account to whoever inherits the address.
type Identity struct {
	ID       int64
	UserID   int64
	Provider string
	Subject  string
	Email    string
	LinkedAt time.Time
}

// Session is a login, held server-side. TokenHash is the sha256 of the value in
// the cookie and the raw token is never stored, so a copy of the database is not
// a set of usable cookies.
type Session struct {
	TokenHash  string
	UserID     int64
	CSRFToken  string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	LastSeenAt time.Time
	UserAgent  string
	IPAddress  string
}

// IsExpired reports whether the session is over at now. The boundary is closed —
// a session expiring exactly now is expired — because the alternative keeps a
// session alive through its own deadline for as long as the clock takes to tick.
func (s Session) IsExpired(now time.Time) bool {
	return !s.ExpiresAt.After(now)
}

// NewToken returns a fresh random token, hex-encoded. It is the source of both
// session tokens and CSRF tokens: they have the same requirements — unguessable,
// single-purpose, never reused — and a second generator would only be a second
// thing to get wrong.
func NewToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate a token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// HashToken returns the hex-encoded sha256 of token. Deterministic, so a lookup
// by hash finds the row the cookie belongs to.
//
// A plain hash rather than a password KDF, deliberately: the input is 32 bytes
// of our own randomness, not a human-chosen secret, so there is no dictionary to
// slow an attacker down with and bcrypt would only make every request expensive.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// TokenMatchesHash reports whether token is the one hash was made from, in
// constant time.
//
// It needs no empty-input guard, and that is worth stating because VerifyCSRF
// below has one and the two functions otherwise look alike. Here one side is
// always a fresh 64-character hash, so an empty argument makes the lengths
// differ and ConstantTimeCompare returns 0 on its own. A guard was written here
// first; removing it broke no test, because there is no case in which it can
// change the answer.
func TokenMatchesHash(hash, token string) bool {
	return subtle.ConstantTimeCompare([]byte(hash), []byte(HashToken(token))) == 1
}

// VerifyCSRF compares the token submitted with a request against the one stored
// on the session, in constant time.
//
// An empty value on either side is a refusal, never a match. Without that, a
// session that somehow holds no CSRF token would accept every request that omits
// the field — the exact request this check exists to reject.
func VerifyCSRF(expected, submitted string) bool {
	if expected == "" || submitted == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(submitted)) == 1
}

// UserStore, IdentityStore and SessionStore are the persistence this package
// needs, declared here because this package is what consumes them
// (backend-code-style.md §The dependency rule). internal/infra/storage/authstore
// implements all three; nothing in this package knows that SQLite exists.
//
// Every lookup that can legitimately find nothing returns ErrNotFound wrapped or
// bare, never a driver's own sentinel.
type UserStore interface {
	// UserByID and UserByEmail return ErrNotFound when there is no such
	// professor. Email matching is case-insensitive, as the schema's collation
	// already is.
	UserByID(ctx context.Context, id int64) (User, error)
	UserByEmail(ctx context.Context, email string) (User, error)
	// CreateUser adds an active professor and returns them with their new ID.
	CreateUser(ctx context.Context, email, name string) (User, error)
	// CountUsers is what the bootstrap path asks before deciding that a server
	// with no professors may adopt the one named by the configuration.
	CountUsers(ctx context.Context) (int, error)
}

type IdentityStore interface {
	// IdentityBySubject looks up the stable login key, returning ErrNotFound
	// when this Google account belongs to nobody here.
	IdentityBySubject(ctx context.Context, provider, subject string) (Identity, error)
	// LinkIdentity binds a provider account to a professor.
	LinkIdentity(ctx context.Context, userID int64, provider, subject, email string) (Identity, error)
}

type SessionStore interface {
	// CreateSession stores a session as given. The caller has already hashed
	// the token: this interface never sees the value that went into the cookie.
	CreateSession(ctx context.Context, s Session) error
	// SessionByTokenHash returns ErrNotFound when no session has that hash.
	// Expiry is NOT its concern — that is Session.IsExpired, so that the policy
	// lives in one place and a store cannot quietly disagree with it.
	SessionByTokenHash(ctx context.Context, hash string) (Session, error)
	// TouchSession records that the session was used, for the operator's
	// benefit rather than for any decision this package makes.
	TouchSession(ctx context.Context, hash string, seen time.Time) error
	// DeleteSession is logout, and is idempotent: deleting a session that is
	// already gone is a successful logout, not an error.
	DeleteSession(ctx context.Context, hash string) error
	// DeleteUserSessions ends every session a professor holds. WP-C3 calls it
	// when it deactivates one; it is here because the professor gate is what
	// gives it meaning.
	DeleteUserSessions(ctx context.Context, userID int64) error
}

// OAuthProvider is the identity provider, declared as this package needs it
// rather than as an OIDC library would model it. internal/infra/oidc implements
// it against Google.
type OAuthProvider interface {
	// AuthCodeURL builds the URL to send the browser to, carrying state as the
	// nonce that ties the callback back to this attempt. The redirect URI is
	// passed in rather than configured here: it belongs to the delivery surface
	// that will receive the callback, and infra may not reach up into it.
	AuthCodeURL(state, redirectURI string) string

	// Exchange completes the callback. An implementation must verify the ID
	// token before returning anything from it — signature against the
	// provider's published keys, audience, issuer, expiry, and that the address
	// is verified — and must return an error rather than partial data on any
	// failure.
	Exchange(ctx context.Context, code, redirectURI string) (email, subject string, err error)
}
