package storage_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/migrations"
)

func TestOpenReachesTheDatabase(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nalanda.db")

	db, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

// The pragmas are set per connection and default to off or to a value that is
// wrong for a server. Nothing above this package can tell whether they were
// applied, and a schema whose foreign keys are not enforced fails silently, by
// keeping rows it should have rejected — so they are asserted here, by asking
// the open connection what it actually has.
func TestOpenAppliesItsPragmas(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	for _, c := range []struct {
		pragma string
		want   string
	}{
		{"foreign_keys", "1"},
		{"journal_mode", "wal"},
		{"busy_timeout", "5000"},
	} {
		t.Run(c.pragma, func(t *testing.T) {
			var got string
			if err := db.QueryRowContext(ctx, "PRAGMA "+c.pragma).Scan(&got); err != nil {
				t.Fatalf("reading PRAGMA %s: %v", c.pragma, err)
			}
			if !strings.EqualFold(got, c.want) {
				t.Errorf("PRAGMA %s = %q, want %q", c.pragma, got, c.want)
			}
		})
	}
}

// Open must fail rather than hand back a handle that only errors on first use.
// database/sql connects lazily, so an Open with no round trip reports success
// for a path nothing can ever write — which is the same lie /health exists to
// prevent, one layer down. AC-3 rests on this behaviour.
func TestOpenFailsOnAnUnusablePath(t *testing.T) {
	ctx := context.Background()

	// A path whose directory component is a regular file. SQLite cannot create
	// the database there, and unlike a permissions trick this holds when the
	// tests run as root, which is the normal case inside a container.
	blocking := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocking, []byte("occupied"), 0o600); err != nil {
		t.Fatalf("preparing the blocking file: %v", err)
	}

	db, err := storage.Open(ctx, filepath.Join(blocking, "nalanda.db"))
	if err == nil {
		_ = db.Close()
		t.Fatal("Open on an unusable path returned no error, want one")
	}
}

func TestMigrateAppliesAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	// A test migration rather than the embedded set: this case is about the
	// runner, and it has to stay meaningful while the real set is still one
	// deliberately-empty file.
	fsys := fstest.MapFS{
		"00001_create_probe.sql": &fstest.MapFile{Data: []byte(
			"-- +goose Up\nCREATE TABLE probe (id INTEGER PRIMARY KEY);\n\n" +
				"-- +goose Down\nDROP TABLE probe;\n",
		)},
	}
	path := filepath.Join(t.TempDir(), "nalanda.db")

	db, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	applied, err := storage.Migrate(ctx, db, fsys)
	if err != nil {
		t.Fatalf("first Migrate: %v", err)
	}
	if applied != 1 {
		t.Errorf("first Migrate applied %d migrations, want 1", applied)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO probe (id) VALUES (1)"); err != nil {
		t.Fatalf("the migration did not create its table: %v", err)
	}
	_ = db.Close()

	// A second boot over the SAME file. Re-running the migration would fail on
	// CREATE TABLE, so an implementation that ignores the version table cannot
	// reach the assertions below.
	reopened, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatalf("reopening: %v", err)
	}
	defer func() { _ = reopened.Close() }()

	reapplied, err := storage.Migrate(ctx, reopened, fsys)
	if err != nil {
		t.Fatalf("second Migrate over the same file: %v", err)
	}
	if reapplied != 0 {
		t.Errorf("second Migrate applied %d migrations, want 0 — a boot over an up-to-date database is a no-op", reapplied)
	}

	var rows int
	if err := reopened.QueryRowContext(ctx, "SELECT count(*) FROM probe").Scan(&rows); err != nil {
		t.Fatalf("counting probe rows: %v", err)
	}
	if rows != 1 {
		t.Errorf("probe rows = %d, want 1 — the second boot rebuilt the table", rows)
	}
}

// The same property over the migrations the binary actually ships, so a set
// that is fine file by file but broken as a sequence fails here rather than at
// boot in production.
func TestTheEmbeddedMigrationsApplyToAFreshDatabase(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nalanda.db")

	db, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	applied, err := storage.Migrate(ctx, db, migrations.FS)
	if err != nil {
		t.Fatalf("first Migrate: %v", err)
	}
	// Non-vacuity: with no migration files at all, "the second boot changed
	// nothing" passes while proving nothing about the sequence.
	if applied == 0 {
		t.Fatal("the embedded set applied nothing, so this test verified no migration")
	}
	_ = db.Close()

	reopened, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatalf("reopening: %v", err)
	}
	defer func() { _ = reopened.Close() }()

	reapplied, err := storage.Migrate(ctx, reopened, migrations.FS)
	if err != nil {
		t.Fatalf("second Migrate over the same file: %v", err)
	}
	if reapplied != 0 {
		t.Errorf("second Migrate applied %d migrations, want 0", reapplied)
	}
}
