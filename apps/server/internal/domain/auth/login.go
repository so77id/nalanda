package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrNotAProfessor is the refusal. It is what a verified Google account gets
// when it belongs to nobody here — which is most of the internet, and is what
// "professor-only" (ADR-0009) means once there is a login button on a public
// page.
var ErrNotAProfessor = errors.New("auth: this account is not a professor")

// Login answers the two questions a delivery surface has: may this verified
// identity log in, and what session do they get.
//
// It lives in the domain rather than in the handler — where DocumentBuddy keeps
// it — because it is what CONSUMES the three store interfaces, and
// backend-code-style.md declares an interface where it is used. With the
// orchestration in the handler, the domain would declare three interfaces it
// never calls, and the rule that keeps this package testable without a database
// would be holding up nothing.
type Login struct {
	Users      UserStore
	Identities IdentityStore
	Sessions   SessionStore

	// Now is the clock; SessionTTL is how long a new session lasts.
	Now        func() time.Time
	SessionTTL time.Duration

	// BootstrapEmail may adopt a server that has no professors at all. Empty
	// disables the path.
	BootstrapEmail string
}

// Authenticate resolves a verified provider identity to a professor.
//
// The caller must have verified the identity already — this package believes
// what it is told, and internal/infra/oidc is what makes that safe by refusing
// any token whose signature, audience, issuer, expiry or email_verified claim
// does not hold.
//
// There are exactly three ways in, and the order matters:
//
//  1. The identity is already linked. The ordinary login.
//  2. No identity, but a professor exists with that verified address: their
//     first login. This is what makes WP-C3's CRUD work — it creates a
//     professor by email and cannot know their Google subject — and it is why
//     DocumentBuddy's invitation flow is not needed here.
//  3. No identity, no professor, no professors AT ALL, and the address is the
//     configured bootstrap: the first professor of a new server.
//
// Everything else is ErrNotAProfessor.
func (l *Login) Authenticate(ctx context.Context, provider, subject, email string) (User, error) {
	identity, err := l.Identities.IdentityBySubject(ctx, provider, subject)
	switch {
	case err == nil:
		user, err := l.Users.UserByID(ctx, identity.UserID)
		if err != nil {
			return User{}, fmt.Errorf("read the professor behind an identity: %w", err)
		}
		return l.admit(user)
	case !errors.Is(err, ErrNotFound):
		return User{}, fmt.Errorf("look the identity up: %w", err)
	}

	// (2) Someone added this professor by address and this is them arriving.
	user, err := l.Users.UserByEmail(ctx, email)
	switch {
	case err == nil:
		admitted, err := l.admit(user)
		if err != nil {
			return User{}, err
		}
		if _, err := l.Identities.LinkIdentity(ctx, admitted.ID, provider, subject, email); err != nil {
			return User{}, fmt.Errorf("link the identity on first login: %w", err)
		}
		return admitted, nil
	case !errors.Is(err, ErrNotFound):
		return User{}, fmt.Errorf("look the professor up by address: %w", err)
	}

	return l.bootstrap(ctx, provider, subject, email)
}

// bootstrap adopts a server with no professors, and only such a server.
func (l *Login) bootstrap(ctx context.Context, provider, subject, email string) (User, error) {
	if l.BootstrapEmail == "" || !strings.EqualFold(email, l.BootstrapEmail) {
		return User{}, ErrNotAProfessor
	}

	// The count is what closes the door behind the first professor: after this
	// has run once, the configured address is inert, so leaving it set is not a
	// standing way in.
	count, err := l.Users.CountUsers(ctx)
	if err != nil {
		return User{}, fmt.Errorf("count the professors: %w", err)
	}
	if count != 0 {
		return User{}, ErrNotAProfessor
	}

	user, err := l.Users.CreateUser(ctx, email, "")
	if err != nil {
		return User{}, fmt.Errorf("create the first professor: %w", err)
	}
	if _, err := l.Identities.LinkIdentity(ctx, user.ID, provider, subject, email); err != nil {
		return User{}, fmt.Errorf("link the first professor's identity: %w", err)
	}
	return user, nil
}

// admit turns a professor who may not log in into the same refusal a stranger
// gets. A deactivated professor who could still sign in would be able to undo
// their own deactivation.
func (l *Login) admit(user User) (User, error) {
	if !user.MayLogIn() {
		return User{}, ErrNotAProfessor
	}
	return user, nil
}

// StartSession issues a session and returns the raw token for the cookie. The
// token is returned and never stored: what reaches the database is its hash.
func (l *Login) StartSession(ctx context.Context, userID int64, userAgent, ipAddress string) (string, Session, error) {
	token, err := NewToken()
	if err != nil {
		return "", Session{}, err
	}
	csrf, err := NewToken()
	if err != nil {
		return "", Session{}, err
	}

	now := l.Now()
	session := Session{
		TokenHash:  HashToken(token),
		UserID:     userID,
		CSRFToken:  csrf,
		CreatedAt:  now,
		ExpiresAt:  now.Add(l.SessionTTL),
		LastSeenAt: now,
		UserAgent:  userAgent,
		IPAddress:  ipAddress,
	}
	if err := l.Sessions.CreateSession(ctx, session); err != nil {
		return "", Session{}, err
	}
	return token, session, nil
}

// EndSession is logout. It takes the raw token because that is what the caller
// has — the cookie — and hashing is this package's business.
func (l *Login) EndSession(ctx context.Context, token string) error {
	return l.Sessions.DeleteSession(ctx, HashToken(token))
}
