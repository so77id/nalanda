package auth_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// The two guards and the "end every session" behaviour live in the domain,
// so a handler test would only rehearse them. What is asserted here is the
// contract; the handler tests then check that the domain's answers reach the
// professor as flash messages.

func admin(t *testing.T) (context.Context, *authstore.Store, *auth.Admin, time.Time) {
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

	now := time.Date(2026, time.August, 16, 15, 0, 0, 0, time.UTC)
	store := authstore.New(db)
	return ctx, store, auth.NewAdmin(auth.Admin{
		Users:    store,
		Sessions: store,
		Now:      func() time.Time { return now },
	}), now
}

func TestDeactivateRefusesSelf(t *testing.T) {
	ctx, store, a, _ := admin(t)

	me, err := store.CreateUser(ctx, "yo@example.com", "Yo")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	_, err = a.Deactivate(ctx, me.ID, me.ID)
	if !errors.Is(err, auth.ErrCannotDeactivateSelf) {
		t.Errorf("Deactivate(self) = %v, want ErrCannotDeactivateSelf", err)
	}

	// The row is untouched: a refused deactivation must not leave a stamp
	// behind.
	got, err := store.UserByID(ctx, me.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if !got.IsActive || got.DeactivatedAt != nil {
		t.Errorf("self is now inactive=%v deactivatedAt=%v after a refused Deactivate", !got.IsActive, got.DeactivatedAt)
	}
}

// Guard 2 is asserted with a synthetic setup: one active target and an
// acting professor who is deactivated. In production the acting one would
// be blocked by RequireProfessor because MayLogIn is false, but the domain
// enforces the count regardless — the guard is a fact about the DATA, not
// the request path.
func TestDeactivateRefusesTheLastActiveProfessor(t *testing.T) {
	ctx, store, a, at := admin(t)

	target, err := store.CreateUser(ctx, "target@example.com", "Target")
	if err != nil {
		t.Fatalf("CreateUser target: %v", err)
	}
	acting, err := store.CreateUser(ctx, "acting@example.com", "Acting")
	if err != nil {
		t.Fatalf("CreateUser acting: %v", err)
	}
	// Take acting out of the active set so target is the only active row.
	if _, err := store.SetActive(ctx, acting.ID, false, at); err != nil {
		t.Fatalf("SetActive acting: %v", err)
	}

	_, err = a.Deactivate(ctx, target.ID, acting.ID)
	if !errors.Is(err, auth.ErrCannotDeactivateLastActive) {
		t.Errorf("Deactivate(last active) = %v, want ErrCannotDeactivateLastActive", err)
	}
	// And target is still active — the refusal must be complete.
	got, err := store.UserByID(ctx, target.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if !got.IsActive {
		t.Errorf("target became inactive after a refused deactivation")
	}
}

func TestDeactivateFlipsFlagAndEndsEverySessionTheTargetHolds(t *testing.T) {
	ctx, store, a, at := admin(t)

	target, err := store.CreateUser(ctx, "target@example.com", "Target")
	if err != nil {
		t.Fatalf("CreateUser target: %v", err)
	}
	acting, err := store.CreateUser(ctx, "acting@example.com", "Acting")
	if err != nil {
		t.Fatalf("CreateUser acting: %v", err)
	}

	// Two live sessions on target, one on acting (which must survive).
	now := time.Date(2026, time.August, 15, 9, 0, 0, 0, time.UTC)
	for _, hash := range []string{"t1", "t2"} {
		if err := store.CreateSession(ctx, auth.Session{
			TokenHash: hash, UserID: target.ID, CSRFToken: "csrf-" + hash,
			CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastSeenAt: now,
		}); err != nil {
			t.Fatalf("seeding session %s: %v", hash, err)
		}
	}
	if err := store.CreateSession(ctx, auth.Session{
		TokenHash: "a1", UserID: acting.ID, CSRFToken: "csrf-a1",
		CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastSeenAt: now,
	}); err != nil {
		t.Fatalf("seeding acting's session: %v", err)
	}

	result, err := a.Deactivate(ctx, target.ID, acting.ID)
	if err != nil {
		t.Fatalf("Deactivate: %v", err)
	}
	if !result.Changed {
		t.Error("result.Changed = false, want true (target was active, guard held)")
	}
	if result.User.IsActive {
		t.Error("returned user still marked active")
	}
	if result.User.DeactivatedAt == nil || !result.User.DeactivatedAt.Equal(at) {
		t.Errorf("DeactivatedAt = %v, want %v", result.User.DeactivatedAt, at)
	}

	// Target's sessions are gone; acting's is not.
	for _, hash := range []string{"t1", "t2"} {
		if _, err := store.SessionByTokenHash(ctx, hash); !errors.Is(err, auth.ErrNotFound) {
			t.Errorf("target's session %s survived deactivation: %v", hash, err)
		}
	}
	if _, err := store.SessionByTokenHash(ctx, "a1"); err != nil {
		t.Errorf("acting's session was collateral: %v", err)
	}
}

// If SetActive fails (unknown target), no sessions are deleted. A no-op
// deactivation must not have side effects.
func TestDeactivateAnUnknownTargetLeavesNoTraces(t *testing.T) {
	ctx, store, a, _ := admin(t)

	me, err := store.CreateUser(ctx, "yo@example.com", "Yo")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	other, err := store.CreateUser(ctx, "other@example.com", "Other")
	if err != nil {
		t.Fatalf("CreateUser other: %v", err)
	}

	// A live session belonging to `other`, which the failed deactivation
	// must not touch (nothing should touch it).
	now := time.Date(2026, time.August, 15, 9, 0, 0, 0, time.UTC)
	if err := store.CreateSession(ctx, auth.Session{
		TokenHash: "keep", UserID: other.ID, CSRFToken: "csrf-keep",
		CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastSeenAt: now,
	}); err != nil {
		t.Fatalf("seeding session: %v", err)
	}

	_, err = a.Deactivate(ctx, 9999, me.ID)
	if !errors.Is(err, auth.ErrNotFound) {
		t.Errorf("Deactivate unknown = %v, want ErrNotFound", err)
	}
	// The unrelated session is still there.
	if _, err := store.SessionByTokenHash(ctx, "keep"); err != nil {
		t.Errorf("an unrelated session was deleted: %v", err)
	}
}

func TestReactivateFlipsTheFlagBack(t *testing.T) {
	ctx, store, a, at := admin(t)

	target, err := store.CreateUser(ctx, "target@example.com", "Target")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := store.SetActive(ctx, target.ID, false, at); err != nil {
		t.Fatalf("SetActive false: %v", err)
	}

	got, err := a.Reactivate(ctx, target.ID)
	if err != nil {
		t.Fatalf("Reactivate: %v", err)
	}
	if !got.IsActive {
		t.Error("returned user is still inactive after Reactivate")
	}
	if got.DeactivatedAt != nil {
		t.Errorf("DeactivatedAt = %v, want nil after Reactivate", got.DeactivatedAt)
	}
}
