// Package authstore is the SQLite side of the professor auth domain: one type
// implementing auth.UserStore, auth.IdentityStore and auth.SessionStore over the
// tables migration 00002 creates.
//
// It lives under internal/infra/storage because that is where ADR-0034 puts
// store implementations, and in its own package so that storage itself stays
// about opening a database and applying migrations. It names no driver: it takes
// a *sql.DB, which is what keeps the Postgres exit of ADR-0007 a change in one
// package.
//
// Three of the shapes here are deliberate and would otherwise look like
// omissions:
//
//   - Times are unix SECONDS, because that is what the columns hold. A caller
//     handing in a time with a fractional part gets it back truncated.
//   - Lookups return auth.ErrNotFound, never database/sql's sentinel. Absence is
//     part of the domain's vocabulary; the driver's is not.
//   - Nothing here filters by expiry. auth.Session.IsExpired owns that rule, and
//     a WHERE clause repeating it would be a second opinion able to disagree.
package authstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
)

// Store is the adapter. One type rather than three, because there is one
// database underneath and three constructors would only be three things to wire;
// consumers still see the narrow interface they asked for.
type Store struct {
	db *sql.DB
}

// New returns a Store over db. The caller owns the handle and its lifetime.
func New(db *sql.DB) *Store {
	return &Store{db: db}
}

// The domain's interfaces, satisfied at compile time — the storage.Prober shape.
var (
	_ auth.UserStore     = (*Store)(nil)
	_ auth.IdentityStore = (*Store)(nil)
	_ auth.SessionStore  = (*Store)(nil)
)

// notFound turns database/sql's absence sentinel into the domain's. Anything
// else is passed through wrapped: a caller that cannot reach the database must
// never read it as "no such professor".
func notFound(err error, subject string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s: %w", subject, auth.ErrNotFound)
	}
	return fmt.Errorf("%s: %w", subject, err)
}

const userColumns = "user_id, email, name, is_active, created_at, deactivated_at, last_login_at"

// scanUser reads the userColumns set in order.
func scanUser(row interface{ Scan(...any) error }) (auth.User, error) {
	var (
		user          auth.User
		createdAt     int64
		deactivatedAt sql.NullInt64
		lastLoginAt   sql.NullInt64
	)
	if err := row.Scan(&user.ID, &user.Email, &user.Name, &user.IsActive, &createdAt, &deactivatedAt, &lastLoginAt); err != nil {
		return auth.User{}, err
	}
	user.CreatedAt = time.Unix(createdAt, 0).UTC()
	if deactivatedAt.Valid {
		at := time.Unix(deactivatedAt.Int64, 0).UTC()
		user.DeactivatedAt = &at
	}
	if lastLoginAt.Valid {
		at := time.Unix(lastLoginAt.Int64, 0).UTC()
		user.LastLoginAt = &at
	}
	return user, nil
}

// UserByID returns the professor with this id.
func (s *Store) UserByID(ctx context.Context, id int64) (auth.User, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+userColumns+" FROM users WHERE user_id = ?", id)

	user, err := scanUser(row)
	if err != nil {
		return auth.User{}, notFound(err, fmt.Sprintf("read the professor %d", id))
	}
	return user, nil
}

// UserByEmail returns the professor with this address. The comparison is
// case-insensitive because the column is COLLATE NOCASE — the folding happens in
// SQLite rather than here, so the lookup and the uniqueness constraint can never
// disagree about whether two addresses are the same person.
func (s *Store) UserByEmail(ctx context.Context, email string) (auth.User, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+userColumns+" FROM users WHERE email = ?", email)

	user, err := scanUser(row)
	if err != nil {
		return auth.User{}, notFound(err, fmt.Sprintf("read the professor %s", email))
	}
	return user, nil
}

// CreateUser adds an active professor.
func (s *Store) CreateUser(ctx context.Context, email, name string) (auth.User, error) {
	row := s.db.QueryRowContext(ctx,
		"INSERT INTO users (email, name) VALUES (?, ?) RETURNING "+userColumns, email, name)

	user, err := scanUser(row)
	if err != nil {
		// Wrapped directly rather than through notFound, which next to the
		// readers above looks like an inconsistency and is not: what this call
		// can fail with is a UNIQUE violation on the email, and that is not
		// sql.ErrNoRows, so the mapping would have nothing to convert. Routing
		// it through notFound anyway changes no behaviour — measured by
		// mutation, TestCreateUserRejectsADuplicateEmailWithoutCallingItAbsence
		// stays green either way. What that test does pin is the outcome the
		// bootstrap path depends on: a duplicate email must never reach a caller
		// as auth.ErrNotFound, whichever branch produced it.
		return auth.User{}, fmt.Errorf("create the professor %s: %w", email, err)
	}
	return user, nil
}

// CountUsers reports how many professors exist. The bootstrap path is gated on
// this being zero.
func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil {
		return 0, fmt.Errorf("count the professors: %w", err)
	}
	return count, nil
}

// RecordLogin stamps users.last_login_at for the given professor. Time is unix
// seconds, matching the rest of the schema; the caller has already decided
// what "now" means (Login.Now), so we do not read the clock here.
func (s *Store) RecordLogin(ctx context.Context, userID int64, at time.Time) error {
	if _, err := s.db.ExecContext(ctx,
		"UPDATE users SET last_login_at = ? WHERE user_id = ?", at.Unix(), userID); err != nil {
		return fmt.Errorf("record the last sign-in of professor %d: %w", userID, err)
	}
	return nil
}

const identityColumns = "id, user_id, provider, subject, email, linked_at"

func scanIdentity(row interface{ Scan(...any) error }) (auth.Identity, error) {
	var (
		identity auth.Identity
		linkedAt int64
	)
	if err := row.Scan(&identity.ID, &identity.UserID, &identity.Provider,
		&identity.Subject, &identity.Email, &linkedAt); err != nil {
		return auth.Identity{}, err
	}
	identity.LinkedAt = time.Unix(linkedAt, 0).UTC()
	return identity, nil
}

// IdentityBySubject looks a provider account up by its stable key.
func (s *Store) IdentityBySubject(ctx context.Context, provider, subject string) (auth.Identity, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+identityColumns+" FROM oauth_identities WHERE provider = ? AND subject = ?",
		provider, subject)

	identity, err := scanIdentity(row)
	if err != nil {
		return auth.Identity{}, notFound(err, fmt.Sprintf("read the %s identity %s", provider, subject))
	}
	return identity, nil
}

// LinkIdentity binds a provider account to a professor.
func (s *Store) LinkIdentity(ctx context.Context, userID int64, provider, subject, email string) error {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)",
		userID, provider, subject, email)
	if err != nil {
		return fmt.Errorf("link the %s identity %s to the professor %d: %w",
			provider, subject, userID, err)
	}
	return nil
}

// CreateSession stores a session exactly as given. The token itself never
// reaches this package: what arrives is its hash.
func (s *Store) CreateSession(ctx context.Context, session auth.Session) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO user_sessions
			(token_hash, user_id, csrf_token, created_at, expires_at, last_seen_at, user_agent, ip_address)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		session.TokenHash, session.UserID, session.CSRFToken,
		session.CreatedAt.Unix(), session.ExpiresAt.Unix(), session.LastSeenAt.Unix(),
		session.UserAgent, session.IPAddress)
	if err != nil {
		return fmt.Errorf("create a session for the professor %d: %w", session.UserID, err)
	}
	return nil
}

// SessionByTokenHash returns the session with this hash, expired or not.
func (s *Store) SessionByTokenHash(ctx context.Context, hash string) (auth.Session, error) {
	var (
		session   auth.Session
		createdAt int64
		expiresAt int64
		lastSeen  int64
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT token_hash, user_id, csrf_token, created_at, expires_at, last_seen_at, user_agent, ip_address
		FROM user_sessions WHERE token_hash = ?`, hash).
		Scan(&session.TokenHash, &session.UserID, &session.CSRFToken,
			&createdAt, &expiresAt, &lastSeen, &session.UserAgent, &session.IPAddress)
	if err != nil {
		// The hash is deliberately absent from the message: it is the only
		// secret-adjacent value here, and a log line naming it would defeat the
		// point of storing a hash rather than the token.
		return auth.Session{}, notFound(err, "read the session")
	}
	session.CreatedAt = time.Unix(createdAt, 0).UTC()
	session.ExpiresAt = time.Unix(expiresAt, 0).UTC()
	session.LastSeenAt = time.Unix(lastSeen, 0).UTC()
	return session, nil
}

// TouchSession records that the session was used.
func (s *Store) TouchSession(ctx context.Context, hash string, seen time.Time) error {
	if _, err := s.db.ExecContext(ctx,
		"UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?", seen.Unix(), hash); err != nil {
		return fmt.Errorf("touch the session: %w", err)
	}
	return nil
}

// DeleteSession is logout. Deleting a session that is already gone succeeds:
// the second request is a professor pressing the button again, and a 500 there
// would be inventing a failure.
func (s *Store) DeleteSession(ctx context.Context, hash string) error {
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM user_sessions WHERE token_hash = ?", hash); err != nil {
		return fmt.Errorf("delete the session: %w", err)
	}
	return nil
}

// DeleteUserSessions ends every session a professor holds.
func (s *Store) DeleteUserSessions(ctx context.Context, userID int64) error {
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM user_sessions WHERE user_id = ?", userID); err != nil {
		return fmt.Errorf("delete the sessions of the professor %d: %w", userID, err)
	}
	return nil
}
