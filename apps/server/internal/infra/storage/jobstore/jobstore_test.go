package jobstore_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/jobstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// migrated opens a fresh SQLite file, applies the embedded migration set
// and inserts one seed control so job rows have their required FK. Same
// shape controlstore_test.go uses.
func migrated(t *testing.T) (context.Context, *sql.DB, string) {
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

	// Seed one professor and one control so job.control_id has a target.
	// The control schema demands NOT NULL name/from_/to_ etc. — spell them.
	if _, err := db.ExecContext(ctx,
		`INSERT INTO users (email, name) VALUES (?, ?)`,
		"profe@example.com", "Profesora"); err != nil {
		t.Fatalf("seeding professor: %v", err)
	}
	var userID int64
	if err := db.QueryRowContext(ctx, `SELECT user_id FROM users WHERE email = ?`,
		"profe@example.com").Scan(&userID); err != nil {
		t.Fatalf("selecting seeded professor id: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
        INSERT INTO control (id, name, from_document, from_section,
                             to_document, to_section, questions_per_copy,
                             copies, duplex_padding, paper, ticked, unsure,
                             state, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"CTRL0001ABC0000000000000AA", "Control 1",
		"doc-1", "sec-1", "doc-1", "sec-2",
		4, 30, 1, "letter", 0.5, 0.3, "generated",
		time.Now().Unix(), userID,
	); err != nil {
		t.Fatalf("seeding control: %v", err)
	}
	return ctx, db, "CTRL0001ABC0000000000000AA"
}

func TestInsertAndByIDRoundTripAJob(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	id, err := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID,
		Kind:      jobs.KindReanalyse,
		Payload:   []byte(`{"ticked":0.5,"unsure":0.3}`),
	}, time.Now())
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if id <= 0 {
		t.Fatalf("Insert returned a non-positive id: %d", id)
	}

	got, err := store.ByID(ctx, id)
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if got.ID != id {
		t.Errorf("ID = %d, want %d", got.ID, id)
	}
	if got.ControlID != controlID {
		t.Errorf("ControlID = %q, want %q", got.ControlID, controlID)
	}
	if got.Kind != jobs.KindReanalyse {
		t.Errorf("Kind = %q, want reanalyse", got.Kind)
	}
	if got.Status != jobs.StatusQueued {
		t.Errorf("Status = %q, want queued", got.Status)
	}
	if string(got.Payload) != `{"ticked":0.5,"unsure":0.3}` {
		t.Errorf("Payload = %q, want the seeded JSON", string(got.Payload))
	}
	if got.CreatedAt.IsZero() {
		t.Errorf("CreatedAt is zero, want a real timestamp")
	}
	if got.StartedAt != nil {
		t.Errorf("StartedAt = %v, want nil on a queued job", got.StartedAt)
	}
	if got.FinishedAt != nil {
		t.Errorf("FinishedAt = %v, want nil on a queued job", got.FinishedAt)
	}
	if got.ViewedAt != nil {
		t.Errorf("ViewedAt = %v, want nil on an undismissed job", got.ViewedAt)
	}
}

func TestByIDReturnsErrJobNotFoundForAnUnknownID(t *testing.T) {
	ctx, db, _ := migrated(t)
	store := jobstore.New(db)

	if _, err := store.ByID(ctx, 999); !errors.Is(err, jobs.ErrJobNotFound) {
		t.Errorf("ByID on a missing id = %v, want ErrJobNotFound", err)
	}
}

func TestMarkRunningStampsStartedAtAndFlipsStatus(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	id, err := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindAnalyse, Payload: []byte(`{}`),
	}, time.Now())
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}

	startedAt := time.Unix(1_735_000_000, 0)
	if err := store.MarkRunning(ctx, id, startedAt); err != nil {
		t.Fatalf("MarkRunning: %v", err)
	}
	got, err := store.ByID(ctx, id)
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if got.Status != jobs.StatusRunning {
		t.Errorf("Status = %q, want running", got.Status)
	}
	if got.StartedAt == nil || !got.StartedAt.Equal(startedAt) {
		t.Errorf("StartedAt = %v, want %v", got.StartedAt, startedAt)
	}
}

func TestMarkDoneStampsFinishedAtAndFlipsStatus(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	id, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindGenerate, Payload: []byte(`{}`),
	}, time.Now())
	_ = store.MarkRunning(ctx, id, time.Unix(1_735_000_000, 0))

	finishedAt := time.Unix(1_735_000_030, 0)
	if err := store.MarkDone(ctx, id, finishedAt); err != nil {
		t.Fatalf("MarkDone: %v", err)
	}
	got, _ := store.ByID(ctx, id)
	if got.Status != jobs.StatusDone {
		t.Errorf("Status = %q, want done", got.Status)
	}
	if got.FinishedAt == nil || !got.FinishedAt.Equal(finishedAt) {
		t.Errorf("FinishedAt = %v, want %v", got.FinishedAt, finishedAt)
	}
}

func TestMarkFailedStoresBothMessages(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	id, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindAnalyse, Payload: []byte(`{}`),
	}, time.Now())
	_ = store.MarkRunning(ctx, id, time.Unix(1_735_000_000, 0))

	finishedAt := time.Unix(1_735_000_010, 0)
	if err := store.MarkFailed(ctx, id, "worker rechazó el escaneo",
		"ERR: /work/… scan not recognized\nMore lines\n", finishedAt); err != nil {
		t.Fatalf("MarkFailed: %v", err)
	}
	got, _ := store.ByID(ctx, id)
	if got.Status != jobs.StatusFailed {
		t.Errorf("Status = %q, want failed", got.Status)
	}
	if got.Error != "worker rechazó el escaneo" {
		t.Errorf("Error = %q, want the short message", got.Error)
	}
	if got.Detail == "" {
		t.Errorf("Detail is empty, want the long context")
	}
	if got.FinishedAt == nil || !got.FinishedAt.Equal(finishedAt) {
		t.Errorf("FinishedAt = %v, want %v", got.FinishedAt, finishedAt)
	}
}

func TestMarkDismissedStampsViewedAt(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	id, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindReanalyse, Payload: []byte(`{}`),
	}, time.Now())
	_ = store.MarkRunning(ctx, id, time.Unix(1_735_000_000, 0))
	_ = store.MarkDone(ctx, id, time.Unix(1_735_000_030, 0))

	viewedAt := time.Unix(1_735_000_500, 0)
	if err := store.MarkDismissed(ctx, id, viewedAt); err != nil {
		t.Fatalf("MarkDismissed: %v", err)
	}
	got, _ := store.ByID(ctx, id)
	if got.ViewedAt == nil || !got.ViewedAt.Equal(viewedAt) {
		t.Errorf("ViewedAt = %v, want %v", got.ViewedAt, viewedAt)
	}
}

func TestLatestForControlReturnsTheMostRecentJob(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	// Explicit distinct clocks: no time.Sleep needed since COR-2 moved
	// createdAt into the Insert parameter — same shape the mark family
	// already uses. LatestForControl orders by created_at DESC, then
	// by id DESC as tie-breaker (see jobstore.go), so a same-second
	// pair would still resolve deterministically; two visibly distinct
	// timestamps here are the honest signal.
	early := time.Unix(1_735_000_000, 0)
	late := time.Unix(1_735_000_030, 0)
	first, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindGenerate, Payload: []byte(`{}`),
	}, early)
	second, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindReanalyse, Payload: []byte(`{}`),
	}, late)

	got, err := store.LatestForControl(ctx, controlID)
	if err != nil {
		t.Fatalf("LatestForControl: %v", err)
	}
	if got.ID != second {
		t.Errorf("LatestForControl.ID = %d, want the most recent (%d), got the earlier (%d)",
			got.ID, second, first)
	}
}

func TestLatestForControlReturnsErrJobNotFoundWhenTheControlHasNoJobs(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	if _, err := store.LatestForControl(ctx, controlID); !errors.Is(err, jobs.ErrJobNotFound) {
		t.Errorf("LatestForControl on a control with no jobs = %v, want ErrJobNotFound", err)
	}
}

func TestQueuedIDsListsEveryQueuedJobOldestFirst(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	first, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindGenerate, Payload: []byte(`{}`),
	}, time.Now())
	second, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindReanalyse, Payload: []byte(`{}`),
	}, time.Now())
	third, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindAnnotate, Payload: []byte(`{}`),
	}, time.Now())
	// Move `second` to `done`, so it drops out of QueuedIDs.
	_ = store.MarkRunning(ctx, second, time.Unix(1_735_000_000, 0))
	_ = store.MarkDone(ctx, second, time.Unix(1_735_000_030, 0))

	ids, err := store.QueuedIDs(ctx)
	if err != nil {
		t.Fatalf("QueuedIDs: %v", err)
	}
	if len(ids) != 2 || ids[0] != first || ids[1] != third {
		t.Errorf("QueuedIDs = %v, want [%d %d] (oldest first, skipping done)",
			ids, first, third)
	}
}

func TestFailRunningWithMessageFlipsEveryRunningRow(t *testing.T) {
	ctx, db, controlID := migrated(t)
	store := jobstore.New(db)

	// Two `running` rows, one `queued` (untouched), one `done` (untouched).
	running1, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindAnalyse, Payload: []byte(`{}`),
	}, time.Now())
	_ = store.MarkRunning(ctx, running1, time.Unix(1_735_000_000, 0))
	running2, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindReanalyse, Payload: []byte(`{}`),
	}, time.Now())
	_ = store.MarkRunning(ctx, running2, time.Unix(1_735_000_000, 0))
	queued, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindGenerate, Payload: []byte(`{}`),
	}, time.Now())
	done, _ := store.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindAnnotate, Payload: []byte(`{}`),
	}, time.Now())
	_ = store.MarkRunning(ctx, done, time.Unix(1_735_000_000, 0))
	_ = store.MarkDone(ctx, done, time.Unix(1_735_000_030, 0))

	finishedAt := time.Unix(1_735_100_000, 0)
	n, err := store.FailRunningWithMessage(ctx, jobs.RestartMidJobError, finishedAt)
	if err != nil {
		t.Fatalf("FailRunningWithMessage: %v", err)
	}
	if n != 2 {
		t.Errorf("FailRunningWithMessage flipped %d rows, want 2", n)
	}

	got1, _ := store.ByID(ctx, running1)
	if got1.Status != jobs.StatusFailed || got1.Error != jobs.RestartMidJobError {
		t.Errorf("running1 = {%q, %q}, want {failed, %q}",
			got1.Status, got1.Error, jobs.RestartMidJobError)
	}
	if got1.FinishedAt == nil || !got1.FinishedAt.Equal(finishedAt) {
		t.Errorf("running1.FinishedAt = %v, want %v", got1.FinishedAt, finishedAt)
	}
	gotQueued, _ := store.ByID(ctx, queued)
	if gotQueued.Status != jobs.StatusQueued {
		t.Errorf("queued row moved to %q, want it untouched", gotQueued.Status)
	}
	gotDone, _ := store.ByID(ctx, done)
	if gotDone.Status != jobs.StatusDone {
		t.Errorf("done row moved to %q, want it untouched", gotDone.Status)
	}
}
