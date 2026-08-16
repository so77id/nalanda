package authstore_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// These are L6 cases: the repositories against a real SQLite file with the
// shipped migrations applied. A mock would only prove that the code calls the
// methods it calls; what is worth asserting here is what the database does with
// the queries — the collation, the constraints and the second-granularity time
// columns.

// store returns a migrated database and the adapter over it. The *sql.DB comes
// back as well so that a case can look at what actually landed in the columns
// without the production type needing an accessor that exists only for tests.
func store(t *testing.T) (context.Context, *sql.DB, *authstore.Store) {
	t.Helper()

	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return ctx, db, authstore.New(db)
}

// The interfaces the domain declares, satisfied by the adapter. Compile-time,
// like storage.Prober against health.Prober.
func TestTheStoreSatisfiesTheDomainInterfaces(t *testing.T) {
	var (
		_ auth.UserStore     = (*authstore.Store)(nil)
		_ auth.IdentityStore = (*authstore.Store)(nil)
		_ auth.SessionStore  = (*authstore.Store)(nil)
	)
}

func TestCreateUserRoundTrips(t *testing.T) {
	ctx, _, s := store(t)

	created, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if created.ID == 0 {
		t.Error("the created professor has no id")
	}
	if !created.IsActive {
		t.Error("a newly created professor is not active, so nobody could ever log in as them")
	}
	if created.CreatedAt.IsZero() {
		t.Error("the created professor has no creation time")
	}

	byID, err := s.UserByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if byID != created {
		t.Errorf("UserByID = %+v, want %+v", byID, created)
	}
}

// Google returns the address as the account holder typed it, so the lookup that
// decides whether a professor exists has to be case-insensitive. The schema's
// COLLATE NOCASE is what does the work; this asserts the query actually benefits
// from it rather than, say, comparing a hashed or trimmed value.
func TestUserByEmailIgnoresCase(t *testing.T) {
	ctx, _, s := store(t)

	created, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	for _, email := range []string{
		"profesora@example.com",
		"Profesora@Example.com",
		"PROFESORA@EXAMPLE.COM",
	} {
		t.Run(email, func(t *testing.T) {
			found, err := s.UserByEmail(ctx, email)
			if err != nil {
				t.Fatalf("UserByEmail(%q): %v", email, err)
			}
			if found.ID != created.ID {
				t.Errorf("UserByEmail(%q) found id %d, want %d", email, found.ID, created.ID)
			}
		})
	}
}

// Absence is a normal condition here — an unknown professor is most of the
// traffic on a login page — and the caller must be able to tell it from a
// database that has stopped answering, without importing database/sql.
func TestAMissingRowIsErrNotFound(t *testing.T) {
	ctx, _, s := store(t)

	t.Run("user by id", func(t *testing.T) {
		if _, err := s.UserByID(ctx, 4242); !errors.Is(err, auth.ErrNotFound) {
			t.Errorf("UserByID of an unknown professor = %v, want auth.ErrNotFound", err)
		}
	})
	t.Run("user by email", func(t *testing.T) {
		if _, err := s.UserByEmail(ctx, "nadie@example.com"); !errors.Is(err, auth.ErrNotFound) {
			t.Errorf("UserByEmail of an unknown address = %v, want auth.ErrNotFound", err)
		}
	})
	t.Run("identity by subject", func(t *testing.T) {
		if _, err := s.IdentityBySubject(ctx, "google", "sub-unknown"); !errors.Is(err, auth.ErrNotFound) {
			t.Errorf("IdentityBySubject of an unknown account = %v, want auth.ErrNotFound", err)
		}
	})
	t.Run("session by token hash", func(t *testing.T) {
		if _, err := s.SessionByTokenHash(ctx, "hash-unknown"); !errors.Is(err, auth.ErrNotFound) {
			t.Errorf("SessionByTokenHash of an unknown hash = %v, want auth.ErrNotFound", err)
		}
	})
}

// A duplicate email is a real error, not an absence. Mapping every failure onto
// ErrNotFound is the shape of bug this separates: the bootstrap path branches on
// ErrNotFound to decide it may create a professor.
func TestCreateUserRejectsADuplicateEmailWithoutCallingItAbsence(t *testing.T) {
	ctx, _, s := store(t)

	if _, err := s.CreateUser(ctx, "profesora@example.com", "Profesora"); err != nil {
		t.Fatalf("first CreateUser: %v", err)
	}

	_, err := s.CreateUser(ctx, "Profesora@example.com", "Otra")
	if err == nil {
		t.Fatal("a second professor with the same email was created, want an error")
	}
	if errors.Is(err, auth.ErrNotFound) {
		t.Errorf("a duplicate email reported %v, which a caller reads as 'no such professor'", err)
	}
}

func TestCountUsers(t *testing.T) {
	ctx, _, s := store(t)

	count, err := s.CountUsers(ctx)
	if err != nil {
		t.Fatalf("CountUsers on a fresh database: %v", err)
	}
	if count != 0 {
		t.Errorf("CountUsers on a fresh database = %d, want 0 — the bootstrap path is gated on this", count)
	}

	for _, email := range []string{"una@example.com", "otra@example.com"} {
		if _, err := s.CreateUser(ctx, email, ""); err != nil {
			t.Fatalf("CreateUser(%s): %v", email, err)
		}
	}

	count, err = s.CountUsers(ctx)
	if err != nil {
		t.Fatalf("CountUsers: %v", err)
	}
	if count != 2 {
		t.Errorf("CountUsers = %d, want 2", count)
	}
}

func TestLinkIdentityRoundTrips(t *testing.T) {
	ctx, _, s := store(t)

	user, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	linked, err := s.LinkIdentity(ctx, user.ID, "google", "sub-1", "profesora@example.com")
	if err != nil {
		t.Fatalf("LinkIdentity: %v", err)
	}
	if linked.ID == 0 || linked.LinkedAt.IsZero() {
		t.Errorf("LinkIdentity returned %+v, want an id and a link time", linked)
	}

	found, err := s.IdentityBySubject(ctx, "google", "sub-1")
	if err != nil {
		t.Fatalf("IdentityBySubject: %v", err)
	}
	if found != linked {
		t.Errorf("IdentityBySubject = %+v, want %+v", found, linked)
	}
}

// The subject is the login key and the email beside it is metadata, so the
// lookup must not quietly match on the address as well: two Google accounts can
// carry the same address over time, and only the subject is stable.
func TestIdentityBySubjectMatchesTheSubjectNotTheEmail(t *testing.T) {
	ctx, _, s := store(t)

	user, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := s.LinkIdentity(ctx, user.ID, "google", "sub-1", "profesora@example.com"); err != nil {
		t.Fatalf("LinkIdentity: %v", err)
	}

	if _, err := s.IdentityBySubject(ctx, "google", "profesora@example.com"); !errors.Is(err, auth.ErrNotFound) {
		t.Errorf("a lookup by the address found an identity (%v), want auth.ErrNotFound", err)
	}
}

// session builds a fixture whose three times are far from the clock and from
// each other, which is load-bearing rather than tidy. They were expires-1h with
// expires at now+1h, which made CreatedAt exactly now: an implementation that
// ignored the given times and stamped time.Now() instead round-tripped
// identically and the mutation went unnoticed.
func session(userID int64, hash string, expires time.Time) auth.Session {
	return auth.Session{
		TokenHash:  hash,
		UserID:     userID,
		CSRFToken:  "csrf-" + hash,
		CreatedAt:  expires.Add(-24 * time.Hour),
		ExpiresAt:  expires,
		LastSeenAt: expires.Add(-12 * time.Hour),
		UserAgent:  "Mozilla/5.0",
		IPAddress:  "192.0.2.10",
	}
}

func TestCreateSessionRoundTrips(t *testing.T) {
	ctx, _, s := store(t)

	user, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	// Whole seconds: the columns hold unix seconds, so a time with a fractional
	// part could not survive the round trip and asserting otherwise would only
	// be asserting the test's own rounding.
	expires := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	want := session(user.ID, "hash-1", expires)

	if err := s.CreateSession(ctx, want); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	got, err := s.SessionByTokenHash(ctx, "hash-1")
	if err != nil {
		t.Fatalf("SessionByTokenHash: %v", err)
	}
	if !got.CreatedAt.Equal(want.CreatedAt) || !got.ExpiresAt.Equal(want.ExpiresAt) || !got.LastSeenAt.Equal(want.LastSeenAt) {
		t.Errorf("times round-tripped as created=%v expires=%v lastSeen=%v, want %v / %v / %v",
			got.CreatedAt, got.ExpiresAt, got.LastSeenAt, want.CreatedAt, want.ExpiresAt, want.LastSeenAt)
	}
	if got.UserID != want.UserID || got.CSRFToken != want.CSRFToken ||
		got.UserAgent != want.UserAgent || got.IPAddress != want.IPAddress || got.TokenHash != want.TokenHash {
		t.Errorf("SessionByTokenHash = %+v, want %+v", got, want)
	}
}

// Expiry is auth.Session.IsExpired's decision, so the store hands the row back
// and lets the caller apply the policy. A store that filtered by expiry itself
// would be a second opinion about the same rule, and the two would disagree the
// first time one of them changed.
func TestSessionByTokenHashReturnsAnExpiredSession(t *testing.T) {
	ctx, _, s := store(t)

	user, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	expired := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	if err := s.CreateSession(ctx, session(user.ID, "hash-old", expired)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	got, err := s.SessionByTokenHash(ctx, "hash-old")
	if err != nil {
		t.Fatalf("SessionByTokenHash of an expired session: %v", err)
	}
	if !got.IsExpired(time.Now()) {
		t.Error("the session came back reporting it is not expired")
	}
}

func TestTouchSession(t *testing.T) {
	ctx, _, s := store(t)

	user, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	expires := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	if err := s.CreateSession(ctx, session(user.ID, "hash-1", expires)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	seen := expires.Add(-time.Minute)
	if err := s.TouchSession(ctx, "hash-1", seen); err != nil {
		t.Fatalf("TouchSession: %v", err)
	}

	got, err := s.SessionByTokenHash(ctx, "hash-1")
	if err != nil {
		t.Fatalf("SessionByTokenHash: %v", err)
	}
	if !got.LastSeenAt.Equal(seen) {
		t.Errorf("LastSeenAt = %v, want %v", got.LastSeenAt, seen)
	}
}

// Logging out twice is a successful logout, not an error: the second request is
// a user pressing the button again, or a browser retrying, and neither should
// produce a 500.
func TestDeleteSessionIsIdempotent(t *testing.T) {
	ctx, _, s := store(t)

	user, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	expires := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	if err := s.CreateSession(ctx, session(user.ID, "hash-1", expires)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	if err := s.DeleteSession(ctx, "hash-1"); err != nil {
		t.Fatalf("first DeleteSession: %v", err)
	}
	if err := s.DeleteSession(ctx, "hash-1"); err != nil {
		t.Errorf("second DeleteSession: %v, want a successful no-op", err)
	}
	if _, err := s.SessionByTokenHash(ctx, "hash-1"); !errors.Is(err, auth.ErrNotFound) {
		t.Errorf("the session survived the delete: %v", err)
	}
}

func TestDeleteUserSessionsLeavesOtherProfessorsAlone(t *testing.T) {
	ctx, _, s := store(t)

	first, err := s.CreateUser(ctx, "una@example.com", "Una")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	second, err := s.CreateUser(ctx, "otra@example.com", "Otra")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	expires := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	for _, c := range []struct {
		user int64
		hash string
	}{{first.ID, "hash-a"}, {first.ID, "hash-b"}, {second.ID, "hash-c"}} {
		if err := s.CreateSession(ctx, session(c.user, c.hash, expires)); err != nil {
			t.Fatalf("CreateSession(%s): %v", c.hash, err)
		}
	}

	if err := s.DeleteUserSessions(ctx, first.ID); err != nil {
		t.Fatalf("DeleteUserSessions: %v", err)
	}

	for _, hash := range []string{"hash-a", "hash-b"} {
		if _, err := s.SessionByTokenHash(ctx, hash); !errors.Is(err, auth.ErrNotFound) {
			t.Errorf("%s survived: %v", hash, err)
		}
	}
	if _, err := s.SessionByTokenHash(ctx, "hash-c"); err != nil {
		t.Errorf("the other professor's session was deleted too: %v", err)
	}
}

// AC-5, asserted where the value actually lands. The cookie carries a raw token
// and the database must hold only its hash — so this case sweeps every text
// column of every auth table looking for the raw value, rather than trusting
// that the one INSERT under review passed the right variable.
func TestTheRawSessionTokenIsNowhereInTheDatabase(t *testing.T) {
	ctx, db, s := store(t)

	user, err := s.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	raw, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	expires := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	stored := session(user.ID, auth.HashToken(raw), expires)
	if err := s.CreateSession(ctx, stored); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	rows, err := db.QueryContext(ctx, `
		SELECT token_hash || ' ' || csrf_token || ' ' || user_agent || ' ' || ip_address FROM user_sessions
		UNION ALL SELECT email || ' ' || name FROM users
		UNION ALL SELECT provider || ' ' || subject || ' ' || email FROM oauth_identities
	`)
	if err != nil {
		t.Fatalf("sweeping the auth tables: %v", err)
	}
	defer func() { _ = rows.Close() }()

	var swept int
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			t.Fatalf("scanning a swept row: %v", err)
		}
		swept++
		if strings.Contains(text, raw) {
			t.Errorf("the raw session token is stored in the database, in %q", text)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterating the swept rows: %v", err)
	}
	// Non-vacuity: a sweep over no rows finds no token and proves nothing.
	if swept == 0 {
		t.Fatal("the sweep read no rows, so it verified nothing")
	}
}
