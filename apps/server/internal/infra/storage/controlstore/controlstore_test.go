package controlstore_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/controlstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// migrated opens a fresh SQLite file, applies the embedded migration set and
// hands back the handle. The same shape schema_test.go uses; kept here so a
// case that cannot reach its assertions has nothing to say about the store.
func migrated(t *testing.T) (context.Context, *sql.DB) {
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
	return ctx, db
}

// insertProfessor creates the row created_by will reference.
func insertProfessor(t *testing.T, ctx context.Context, db *sql.DB, email string) int64 {
	t.Helper()
	result, err := db.ExecContext(ctx,
		"INSERT INTO users (email, name) VALUES (?, ?)", email, "Profesora")
	if err != nil {
		t.Fatalf("insert professor: %v", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}
	return id
}

func newControl(id string, userID int64, appDate *time.Time) controls.Control {
	return controls.Control{
		ID:               id,
		Name:             "Control 1",
		ApplicationDate:  appDate,
		RangeFrom:        bank.SectionRef{Document: "flujo", Section: "if-else"},
		RangeTo:          bank.SectionRef{Document: "flujo", Section: "bucles"},
		QuestionsPerCopy: 4,
		Copies:           3,
		State:            controls.Generated,
		CreatedAt:        time.Unix(1_755_360_000, 0).UTC(),
		CreatedBy:        userID,
	}
}

func TestCreateControlWritesTheRowThePoolAndTheCopies(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	date := time.Unix(1_755_446_400, 0).UTC()
	c := newControl("CTRL0001ABC0000000000000AA", userID, &date)
	pool := []controls.PoolEntry{
		{Ref: "q-if-1", Order: 0},
		{Ref: "q-bucles-1", Order: 1},
	}
	if err := store.CreateControl(ctx, c, pool); err != nil {
		t.Fatalf("CreateControl: %v", err)
	}

	got, err := store.ControlByID(ctx, c.ID)
	if err != nil {
		t.Fatalf("ControlByID: %v", err)
	}
	if got.Name != c.Name || got.QuestionsPerCopy != 4 || got.Copies != 3 || got.State != controls.Generated {
		t.Errorf("ControlByID = %+v", got)
	}
	if got.ApplicationDate == nil || !got.ApplicationDate.Equal(date) {
		t.Errorf("ApplicationDate = %v, want %v", got.ApplicationDate, date)
	}
	if got.CreatedBy != userID {
		t.Errorf("CreatedBy = %d, want %d", got.CreatedBy, userID)
	}

	gotPool, err := store.ControlPool(ctx, c.ID)
	if err != nil {
		t.Fatalf("ControlPool: %v", err)
	}
	if len(gotPool) != 2 || gotPool[0].Ref != "q-if-1" || gotPool[1].Order != 1 {
		t.Errorf("ControlPool = %v", gotPool)
	}

	var copies int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM copia WHERE control_id = ?", c.ID).Scan(&copies); err != nil {
		t.Fatalf("count copies: %v", err)
	}
	if copies != 3 {
		t.Errorf("copies rows = %d, want 3 (one per printed sheet)", copies)
	}
}

func TestCreateControlIsAllOrNothingOnAConflict(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	c := newControl("CTRL0002ABC0000000000000AA", userID, nil)
	pool := []controls.PoolEntry{
		{Ref: "q-if-1", Order: 0},
		{Ref: "q-if-1", Order: 1}, // duplicate ref: the compound PK on control_pregunta will reject the second insert
	}
	if err := store.CreateControl(ctx, c, pool); err == nil {
		t.Fatal("CreateControl accepted a duplicate pool ref, want a UNIQUE error")
	}

	// The rollback must have removed EVERY trace — control, pool and copies.
	var rows int
	for _, table := range []string{"control", "control_pregunta", "copia"} {
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&rows); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if rows != 0 {
			t.Errorf("%s still holds %d row(s) after a rolled-back CreateControl, want 0", table, rows)
		}
	}
}

func TestControlByIDReturnsErrControlNotFoundForAMissingID(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)

	_, err := store.ControlByID(ctx, "does-not-exist")
	if !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("ControlByID(missing): %v, want ErrControlNotFound", err)
	}
}

func TestListControlsOrdersByApplicationDateDescWithNullsLast(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	// Three controls, mixed application_date. Application: sep 5, no date,
	// sep 3. Created-at is 2 hours apart so the tie-breaker is visible if
	// the primary order is ambiguous.
	earlyDate := time.Unix(1_756_128_000, 0).UTC() // sep 3
	lateDate := time.Unix(1_756_300_800, 0).UTC()  // sep 5

	first := newControl("CTRL0011LATE00000000000000", userID, &lateDate)
	second := newControl("CTRL0012NIL0000000000000000"[:26], userID, nil)
	second.CreatedAt = first.CreatedAt.Add(2 * time.Hour)
	third := newControl("CTRL0013EARLY00000000000000"[:26], userID, &earlyDate)
	third.CreatedAt = first.CreatedAt.Add(4 * time.Hour)

	for _, c := range []controls.Control{first, second, third} {
		if err := store.CreateControl(ctx, c, []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}); err != nil {
			t.Fatalf("CreateControl(%s): %v", c.ID, err)
		}
	}

	list, err := store.ListControls(ctx)
	if err != nil {
		t.Fatalf("ListControls: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("ListControls returned %d rows, want 3", len(list))
	}
	// Expected order: dated late first (Sep 5), dated early (Sep 3),
	// then the undated one last — the "NULLs last" clause is what puts an
	// undated control below a real one.
	if list[0].ID != first.ID || list[1].ID != third.ID || list[2].ID != second.ID {
		got := []string{list[0].ID, list[1].ID, list[2].ID}
		t.Errorf("ListControls order = %v, want [%s %s %s] (late, early, nil-last)",
			got, first.ID, third.ID, second.ID)
	}
}

func TestDeletingAControlCascadesToItsPoolAndCopies(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	c := newControl("CTRL0021CASCADE0000000000A", userID, nil)
	if err := store.CreateControl(ctx, c, []controls.PoolEntry{
		{Ref: "q-if-1", Order: 0},
		{Ref: "q-bucles-1", Order: 1},
	}); err != nil {
		t.Fatalf("CreateControl: %v", err)
	}

	if _, err := db.ExecContext(ctx, "DELETE FROM control WHERE id = ?", c.ID); err != nil {
		t.Fatalf("delete control: %v", err)
	}

	for _, table := range []string{"control_pregunta", "copia"} {
		var rows int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE control_id = ?", c.ID).Scan(&rows); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if rows != 0 {
			t.Errorf("%s still holds %d row(s) after the control was deleted, want 0", table, rows)
		}
	}
}

func TestCreateControlRefusesAnUnknownProfessor(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)

	c := newControl("CTRL0031ORPHAN0000000000AA", 4242, nil)
	err := store.CreateControl(ctx, c, []controls.PoolEntry{{Ref: "q-if-1", Order: 0}})
	if err == nil {
		t.Fatal("CreateControl accepted a control with no professor, want a FOREIGN KEY error")
	}
}
