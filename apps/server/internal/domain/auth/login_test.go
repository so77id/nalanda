package auth_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// The domain package is pure, but its tests are not required to be: these drive
// the real repositories, because what is being decided here — "may this Google
// account log in?" — is a question about rows, and a fake store would answer
// with whatever this file assumed.

const provider = "google"

func login(t *testing.T, bootstrapEmail string) (context.Context, *sql.DB, *authstore.Store, *auth.Login, time.Time) {
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

	now := time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC)
	store := authstore.New(db)
	return ctx, db, store, &auth.Login{
		Users:          store,
		Identities:     store,
		Sessions:       store,
		Now:            func() time.Time { return now },
		SessionTTL:     24 * time.Hour,
		BootstrapEmail: bootstrapEmail,
	}, now
}

// The ordinary case: a professor who has logged in before.
func TestAuthenticateFindsAProfessorByTheirLinkedIdentity(t *testing.T) {
	ctx, _, store, service, _ := login(t, "")

	created, err := store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := store.LinkIdentity(ctx, created.ID, provider, "sub-1", "profesora@example.com"); err != nil {
		t.Fatalf("LinkIdentity: %v", err)
	}

	found, err := service.Authenticate(ctx, provider, "sub-1", "profesora@example.com")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if found.ID != created.ID {
		t.Errorf("Authenticate returned professor %d, want %d", found.ID, created.ID)
	}
}

// The identity, not the address, is what is matched. A Google account holder can
// change their address, and the professor must survive it.
func TestAuthenticateFollowsTheIdentityWhenTheAddressChanges(t *testing.T) {
	ctx, _, store, service, _ := login(t, "")

	created, err := store.CreateUser(ctx, "antigua@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := store.LinkIdentity(ctx, created.ID, provider, "sub-1", "antigua@example.com"); err != nil {
		t.Fatalf("LinkIdentity: %v", err)
	}

	found, err := service.Authenticate(ctx, provider, "sub-1", "nueva@example.com")
	if err != nil {
		t.Fatalf("Authenticate with a changed address: %v", err)
	}
	if found.ID != created.ID {
		t.Errorf("Authenticate returned professor %d, want %d", found.ID, created.ID)
	}
}

// The first login of a professor somebody else added. WP-C3's CRUD creates a
// professor by email and nothing else — no identity row exists until they arrive
// — so without this branch every professor added through that screen would be
// refused forever, and the CRUD would produce accounts nobody can use.
//
// It is safe because the address is one the provider has verified: the ID token
// is refused unless email_verified is true (internal/infra/oidc).
func TestAuthenticateAdoptsAProfessorWhoWasAddedByEmail(t *testing.T) {
	ctx, _, store, service, _ := login(t, "")

	invited, err := store.CreateUser(ctx, "invitada@example.com", "Invitada")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	found, err := service.Authenticate(ctx, provider, "sub-new", "Invitada@Example.com")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if found.ID != invited.ID {
		t.Errorf("Authenticate returned professor %d, want the invited %d", found.ID, invited.ID)
	}

	// And the identity is now linked, so the next login takes the ordinary path
	// and a change of address no longer matters.
	identity, err := store.IdentityBySubject(ctx, provider, "sub-new")
	if err != nil {
		t.Fatalf("the identity was not linked: %v", err)
	}
	if identity.UserID != invited.ID {
		t.Errorf("the identity was linked to professor %d, want %d", identity.UserID, invited.ID)
	}
}

// AC-2: the bootstrap, which is what makes the server usable before any screen
// exists to add a professor with.
func TestAuthenticateBootstrapsTheFirstProfessor(t *testing.T) {
	ctx, _, store, service, _ := login(t, "primera@example.com")

	found, err := service.Authenticate(ctx, provider, "sub-1", "Primera@example.com")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if found.ID == 0 || found.Email != "Primera@example.com" {
		t.Errorf("Authenticate created %+v, want the bootstrap professor", found)
	}
	if !found.MayLogIn() {
		t.Error("the bootstrapped professor may not log in")
	}

	identity, err := store.IdentityBySubject(ctx, provider, "sub-1")
	if err != nil {
		t.Fatalf("the bootstrap did not link the identity: %v", err)
	}
	if identity.UserID != found.ID {
		t.Errorf("the identity belongs to professor %d, want %d", identity.UserID, found.ID)
	}
}

// The bootstrap is a door that closes behind itself. Once ANY professor exists
// the address stops being able to adopt the server, so a configuration left in
// place after the first login is not a standing back door.
func TestTheBootstrapClosesOnceAProfessorExists(t *testing.T) {
	ctx, _, store, service, _ := login(t, "primera@example.com")

	if _, err := store.CreateUser(ctx, "otra@example.com", "Otra"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	_, err := service.Authenticate(ctx, provider, "sub-1", "primera@example.com")
	if !errors.Is(err, auth.ErrNotAProfessor) {
		t.Errorf("Authenticate = %v, want ErrNotAProfessor — the bootstrap stayed open", err)
	}
}

// AC-1. Everything that is not one of the three paths above is refused, and no
// row is created on the way out.
func TestAuthenticateRefusesEverybodyElse(t *testing.T) {
	for _, c := range []struct {
		name           string
		bootstrapEmail string
		email          string
	}{
		{"a stranger, with no bootstrap configured", "", "cualquiera@example.com"},
		{"a stranger, with a bootstrap for another address", "primera@example.com", "cualquiera@example.com"},
	} {
		t.Run(c.name, func(t *testing.T) {
			ctx, _, store, service, _ := login(t, c.bootstrapEmail)

			_, err := service.Authenticate(ctx, provider, "sub-stranger", c.email)
			if !errors.Is(err, auth.ErrNotAProfessor) {
				t.Fatalf("Authenticate = %v, want ErrNotAProfessor", err)
			}

			count, err := store.CountUsers(ctx)
			if err != nil {
				t.Fatalf("CountUsers: %v", err)
			}
			if count != 0 {
				t.Errorf("%d professor(s) exist after a refusal, want 0", count)
			}
		})
	}
}

// A deactivated professor is refused at the door as well as mid-session: without
// this they could simply log in again and undo the deactivation themselves.
func TestAuthenticateRefusesADeactivatedProfessor(t *testing.T) {
	ctx, db, store, service, _ := login(t, "")

	created, err := store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := store.LinkIdentity(ctx, created.ID, provider, "sub-1", "profesora@example.com"); err != nil {
		t.Fatalf("LinkIdentity: %v", err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE users SET is_active = 0 WHERE user_id = ?", created.ID); err != nil {
		t.Fatalf("deactivating: %v", err)
	}

	if _, err := service.Authenticate(ctx, provider, "sub-1", "profesora@example.com"); !errors.Is(err, auth.ErrNotAProfessor) {
		t.Errorf("Authenticate = %v, want ErrNotAProfessor", err)
	}
}

func TestStartSessionIssuesATokenTheStoreOnlyKnowsTheHashOf(t *testing.T) {
	ctx, _, store, service, now := login(t, "")

	user, err := store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	token, session, err := service.StartSession(ctx, user.ID, "Mozilla/5.0", "192.0.2.10")
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	if token == "" {
		t.Fatal("StartSession returned no token")
	}
	if session.TokenHash != auth.HashToken(token) {
		t.Error("the session does not carry the hash of the token that was issued")
	}
	if session.CSRFToken == "" || session.CSRFToken == token {
		t.Error("the CSRF token is missing, or is the session token again")
	}
	if !session.ExpiresAt.Equal(now.Add(24 * time.Hour)) {
		t.Errorf("ExpiresAt = %v, want now + the configured TTL", session.ExpiresAt)
	}

	stored, err := store.SessionByTokenHash(ctx, auth.HashToken(token))
	if err != nil {
		t.Fatalf("the session was not stored: %v", err)
	}
	if stored.UserID != user.ID {
		t.Errorf("the stored session belongs to professor %d, want %d", stored.UserID, user.ID)
	}
}

// Two logins are two sessions: signing in on a phone must not end the session on
// a laptop, and reusing a token across logins would make a stolen one immortal.
func TestEveryLoginIssuesADifferentToken(t *testing.T) {
	ctx, _, store, service, _ := login(t, "")

	user, err := store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	first, _, err := service.StartSession(ctx, user.ID, "", "")
	if err != nil {
		t.Fatalf("first StartSession: %v", err)
	}
	second, _, err := service.StartSession(ctx, user.ID, "", "")
	if err != nil {
		t.Fatalf("second StartSession: %v", err)
	}

	if first == second {
		t.Fatal("two logins produced the same token")
	}
	for _, token := range []string{first, second} {
		if _, err := store.SessionByTokenHash(ctx, auth.HashToken(token)); err != nil {
			t.Errorf("a session was lost: %v", err)
		}
	}
}

func TestEndSessionRemovesIt(t *testing.T) {
	ctx, _, store, service, _ := login(t, "")

	user, err := store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	token, _, err := service.StartSession(ctx, user.ID, "", "")
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}

	if err := service.EndSession(ctx, token); err != nil {
		t.Fatalf("EndSession: %v", err)
	}
	if _, err := store.SessionByTokenHash(ctx, auth.HashToken(token)); !errors.Is(err, auth.ErrNotFound) {
		t.Errorf("the session survived EndSession: %v", err)
	}

	// Idempotent, for the same reason the store is: the second press of a
	// logout button is not an error.
	if err := service.EndSession(ctx, token); err != nil {
		t.Errorf("a second EndSession: %v", err)
	}
}

// COR-1. Path 2 — a professor added by email, arriving for the first time —
// also checks MayLogIn, and nothing exercised that. It matters precisely
// because that path is WP-C3's create-by-email CRUD: a professor deactivated
// before they ever signed in must not be able to sign in, and must not have an
// identity linked to them on the way out.
func TestAuthenticateRefusesADeactivatedProfessorWhoNeverSignedIn(t *testing.T) {
	ctx, db, store, service, _ := login(t, "")

	created, err := store.CreateUser(ctx, "invitada@example.com", "Invitada")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE users SET is_active = 0 WHERE user_id = ?", created.ID); err != nil {
		t.Fatalf("deactivating: %v", err)
	}

	if _, err := service.Authenticate(ctx, provider, "sub-never-seen", "invitada@example.com"); !errors.Is(err, auth.ErrNotAProfessor) {
		t.Fatalf("Authenticate = %v, want ErrNotAProfessor", err)
	}

	// And no identity was linked to the account that was refused — otherwise a
	// refusal would quietly hand the Google account a claim on the professor.
	if _, err := store.IdentityBySubject(ctx, provider, "sub-never-seen"); !errors.Is(err, auth.ErrNotFound) {
		t.Errorf("an identity was linked to a refused account: %v", err)
	}
}

// RecordLastSignIn stamps users.last_login_at with the domain's clock. It
// exists as a domain method so the login handler does not have to touch the
// store directly, and its failure is bookkeeping the caller may log and swallow
// (issue #151 S3, same shape as SessionStore.TouchSession).
func TestRecordLastSignInStampsTheUsersRow(t *testing.T) {
	ctx, _, store, service, now := login(t, "")

	created, err := store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if err := service.RecordLastSignIn(ctx, created.ID); err != nil {
		t.Fatalf("RecordLastSignIn: %v", err)
	}

	got, err := store.UserByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if got.LastLoginAt == nil {
		t.Fatalf("LastLoginAt is nil after RecordLastSignIn, want the domain's clock (%v)", now)
	}
	if !got.LastLoginAt.Equal(now) {
		t.Errorf("LastLoginAt = %v, want %v (the domain's clock)", *got.LastLoginAt, now)
	}
}
