package storage_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/health"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
)

// The compile-time half of the seam: infra implements the domain's interface.
// If this stops holding, the failure names the contract instead of surfacing as
// a confusing wiring error in main.
var _ health.Prober = (*storage.Prober)(nil)

func TestProbeSucceedsAgainstAnOpenDatabase(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	if err := storage.NewProber(db).Probe(ctx); err != nil {
		t.Errorf("Probe against an open database = %v, want nil", err)
	}
}

// The case that matters, and the one AC-3 is written for: a database that has
// gone away must make the probe fail. A closed handle is the reachable stand-in
// for a deleted file or an unmounted volume — all three are "the pool cannot
// serve a query".
func TestProbeFailsOnceTheDatabaseIsGone(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	prober := storage.NewProber(db)
	if err := prober.Probe(ctx); err != nil {
		t.Fatalf("Probe before closing = %v, want nil", err)
	}

	if err := db.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	if err := prober.Probe(ctx); err == nil {
		t.Error("Probe against a closed database = nil, want an error")
	}
}
