package controlstore_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strconv"
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
		// Issue #197: the product defaults, like Service.PrepareControl writes.
		Ticked: controls.DefaultTicked,
		Unsure: controls.DefaultUnsure,
		// Issue #208: the operational default (ADR-0043).
		Paper:     controls.DefaultPaper,
		State:     controls.Generated,
		CreatedAt: time.Unix(1_755_360_000, 0).UTC(),
		CreatedBy: userID,
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

// Issue #185: the professor's duplex-padding preference persists on the
// control so a future WP-G regenerate honours it. Both values round-trip.
func TestCreateControlPersistsDuplexPaddingBothWays(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	pool := []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}
	for _, tc := range []struct {
		id  string
		val bool
	}{
		{"CTRLPAD00000000000000000TT", true},
		{"CTRLPAD00000000000000000FF", false},
	} {
		c := newControl(tc.id, userID, nil)
		c.DuplexPadding = tc.val
		if err := store.CreateControl(ctx, c, pool); err != nil {
			t.Fatalf("CreateControl(%s, %v): %v", tc.id, tc.val, err)
		}
		got, err := store.ControlByID(ctx, tc.id)
		if err != nil {
			t.Fatalf("ControlByID(%s): %v", tc.id, err)
		}
		if got.DuplexPadding != tc.val {
			t.Errorf("round-trip: DuplexPadding = %v, want %v", got.DuplexPadding, tc.val)
		}
	}
}

// Issue #208: the professor's paper choice persists on the control so a future
// WP-G regenerate honours it. Both values round-trip.
func TestCreateControlPersistsPaperBothWays(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	pool := []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}
	for _, tc := range []struct {
		id  string
		val controls.Paper
	}{
		{"CTRLPAPER000000000000000LT", controls.PaperLetter},
		{"CTRLPAPER000000000000000A4", controls.PaperA4},
	} {
		c := newControl(tc.id, userID, nil)
		c.Paper = tc.val
		if err := store.CreateControl(ctx, c, pool); err != nil {
			t.Fatalf("CreateControl(%s, %v): %v", tc.id, tc.val, err)
		}
		got, err := store.ControlByID(ctx, tc.id)
		if err != nil {
			t.Fatalf("ControlByID(%s): %v", tc.id, err)
		}
		if got.Paper != tc.val {
			t.Errorf("round-trip: Paper = %v, want %v", got.Paper, tc.val)
		}
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

// Issue #190: RecordAnnotated is UPSERT — re-annotating a copia replaces its
// row rather than growing history. AnnotatedByCopy is the review page's
// single-row lookup; returns exists=false when there is no row so the caller
// can fall back to the raw scan.
func TestRecordAnnotatedInsertsAndUpsertsAndAnnotatedByCopyReadsBack(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	c := newControl("CTRLANNOT00000000000000AA1", userID, nil)
	pool := []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}
	if err := store.CreateControl(ctx, c, pool); err != nil {
		t.Fatalf("CreateControl: %v", err)
	}

	first := controls.AnnotatedCopy{
		ControlID: c.ID, CopyNumber: 2,
		GeneratedAt: time.Unix(1_787_100_000, 0).UTC(),
		Path:        "controls/CTRLANNOT00000000000000AA1/annotated/copy-2.pdf",
	}
	if err := store.RecordAnnotated(ctx, first); err != nil {
		t.Fatalf("RecordAnnotated first: %v", err)
	}

	got, ok, err := store.AnnotatedByCopy(ctx, c.ID, 2)
	if err != nil {
		t.Fatalf("AnnotatedByCopy: %v", err)
	}
	if !ok {
		t.Fatal("AnnotatedByCopy exists=false after RecordAnnotated, want true")
	}
	if got.Path != first.Path || !got.GeneratedAt.Equal(first.GeneratedAt) {
		t.Errorf("read back = %+v, want %+v", got, first)
	}

	// UPSERT: a second RecordAnnotated with the same (control, copy) replaces
	// the row instead of leaving two.
	second := controls.AnnotatedCopy{
		ControlID: c.ID, CopyNumber: 2,
		GeneratedAt: time.Unix(1_787_200_000, 0).UTC(),
		Path:        "controls/CTRLANNOT00000000000000AA1/annotated/copy-2.pdf",
	}
	if err := store.RecordAnnotated(ctx, second); err != nil {
		t.Fatalf("RecordAnnotated second (should UPSERT): %v", err)
	}

	got2, _, err := store.AnnotatedByCopy(ctx, c.ID, 2)
	if err != nil {
		t.Fatalf("AnnotatedByCopy after UPSERT: %v", err)
	}
	if !got2.GeneratedAt.Equal(second.GeneratedAt) {
		t.Errorf("generated_at after UPSERT = %v, want %v", got2.GeneratedAt, second.GeneratedAt)
	}

	var count int
	if err := db.QueryRowContext(ctx,
		"SELECT count(*) FROM annotated_copy WHERE control_id = ? AND copy_number = ?",
		c.ID, 2,
	).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("row count = %d after two RecordAnnotated for the same copy, want 1 (UPSERT, not INSERT-and-grow)", count)
	}
}

func TestAnnotatedByCopyReturnsFalseWhenMissing(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)

	_, ok, err := store.AnnotatedByCopy(ctx, "CTRLNONE0000000000000000AA", 1)
	if err != nil {
		t.Fatalf("AnnotatedByCopy(missing) unexpected error: %v", err)
	}
	if ok {
		t.Error("AnnotatedByCopy returned exists=true for a copy that was never annotated")
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

func TestClearAnnotatedDeletesEveryRowOfOneControlOnly(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	c1 := newControl("CTRLCLEAR10000000000000AA1", userID, nil)
	c2 := newControl("CTRLCLEAR20000000000000AA1", userID, nil)
	pool := []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}
	for _, c := range []controls.Control{c1, c2} {
		if err := store.CreateControl(ctx, c, pool); err != nil {
			t.Fatalf("CreateControl: %v", err)
		}
	}
	now := time.Unix(1_787_100_000, 0).UTC()
	for _, c := range []controls.Control{c1, c2} {
		for _, n := range []int{1, 2} {
			if err := store.RecordAnnotated(ctx, controls.AnnotatedCopy{
				ControlID: c.ID, CopyNumber: n, GeneratedAt: now,
				Path: "controls/" + c.ID + "/annotated/copy-" + strconv.Itoa(n) + ".pdf",
			}); err != nil {
				t.Fatalf("RecordAnnotated: %v", err)
			}
		}
	}

	if err := store.ClearAnnotated(ctx, c1.ID); err != nil {
		t.Fatalf("ClearAnnotated: %v", err)
	}
	for _, n := range []int{1, 2} {
		if _, exists, err := store.AnnotatedByCopy(ctx, c1.ID, n); err != nil || exists {
			t.Errorf("c1 copy %d: exists=%v err=%v, want gone", n, exists, err)
		}
		// The OTHER control's rows are untouched — the delete is scoped.
		if _, exists, err := store.AnnotatedByCopy(ctx, c2.ID, n); err != nil || !exists {
			t.Errorf("c2 copy %d: exists=%v err=%v, want intact", n, exists, err)
		}
	}
}

// Issue #261: ListControls filters out archived rows. A soft-deleted control
// disappears from the main /controls listing but the row is still in the
// table — ListArchivedControls sees it, and Restore brings it back.
func TestListControlsHidesArchivedRowsAndArchivedListShowsThem(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	pool := []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}
	active := newControl("CTRLACTIVE0000000000000000", userID, nil)
	archived := newControl("CTRLARCHIVED00000000000000", userID, nil)
	for _, c := range []controls.Control{active, archived} {
		if err := store.CreateControl(ctx, c, pool); err != nil {
			t.Fatalf("CreateControl(%s): %v", c.ID, err)
		}
	}

	archivedAt := time.Unix(1_787_500_000, 0).UTC()
	if err := store.SoftDeleteControl(ctx, archived.ID, archivedAt); err != nil {
		t.Fatalf("SoftDeleteControl: %v", err)
	}

	list, err := store.ListControls(ctx)
	if err != nil {
		t.Fatalf("ListControls: %v", err)
	}
	if len(list) != 1 || list[0].ID != active.ID {
		ids := make([]string, len(list))
		for i, c := range list {
			ids[i] = c.ID
		}
		t.Fatalf("ListControls = %v, want [%s] only (archived rows must be hidden)", ids, active.ID)
	}
	if list[0].DeletedAt != nil {
		t.Errorf("active row DeletedAt = %v, want nil", list[0].DeletedAt)
	}

	arch, err := store.ListArchivedControls(ctx)
	if err != nil {
		t.Fatalf("ListArchivedControls: %v", err)
	}
	if len(arch) != 1 || arch[0].ID != archived.ID {
		t.Fatalf("ListArchivedControls = %+v, want the archived row only", arch)
	}
	if arch[0].DeletedAt == nil || !arch[0].DeletedAt.Equal(archivedAt) {
		t.Errorf("archived row DeletedAt = %v, want %v", arch[0].DeletedAt, archivedAt)
	}
}

// Issue #261: archived rows are surfaced newest-first, so what a professor
// just archived is at the top of /controls/archived. Two rows archived in
// the SAME unix second (a batch archive) are broken by created_at DESC —
// Round-A COR-2 added the tie-breaker so this case is deterministic
// rather than depending on the row layout.
func TestListArchivedControlsOrdersByDeletedAtDescThenCreatedAtDesc(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	pool := []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}
	// Two rows archived in DIFFERENT seconds — the primary sort holds.
	older := newControl("CTRLARCHOLDER00000000000AA", userID, nil)
	newer := newControl("CTRLARCHNEWER00000000000AA", userID, nil)
	// Two rows archived in the SAME second — the tie-breaker holds.
	// tieOlderCreated has an earlier created_at; tieNewerCreated is later.
	tieOlderCreated := newControl("CTRLARCHTIEOLD0000000000AA", userID, nil)
	tieOlderCreated.CreatedAt = time.Unix(1_787_000_000, 0).UTC()
	tieNewerCreated := newControl("CTRLARCHTIENEW0000000000AA", userID, nil)
	tieNewerCreated.CreatedAt = time.Unix(1_787_050_000, 0).UTC()
	for _, c := range []controls.Control{older, newer, tieOlderCreated, tieNewerCreated} {
		if err := store.CreateControl(ctx, c, pool); err != nil {
			t.Fatalf("CreateControl(%s): %v", c.ID, err)
		}
	}
	sameSecond := time.Unix(1_787_600_000, 0).UTC()
	if err := store.SoftDeleteControl(ctx, older.ID, time.Unix(1_787_100_000, 0).UTC()); err != nil {
		t.Fatalf("SoftDeleteControl(older): %v", err)
	}
	if err := store.SoftDeleteControl(ctx, newer.ID, time.Unix(1_787_500_000, 0).UTC()); err != nil {
		t.Fatalf("SoftDeleteControl(newer): %v", err)
	}
	if err := store.SoftDeleteControl(ctx, tieOlderCreated.ID, sameSecond); err != nil {
		t.Fatalf("SoftDeleteControl(tieOlderCreated): %v", err)
	}
	if err := store.SoftDeleteControl(ctx, tieNewerCreated.ID, sameSecond); err != nil {
		t.Fatalf("SoftDeleteControl(tieNewerCreated): %v", err)
	}

	arch, err := store.ListArchivedControls(ctx)
	if err != nil {
		t.Fatalf("ListArchivedControls: %v", err)
	}
	// Expected order: same-second-newer-created, same-second-older-created,
	// then newer (deleted second), then older (deleted first).
	want := []string{tieNewerCreated.ID, tieOlderCreated.ID, newer.ID, older.ID}
	if len(arch) != len(want) {
		t.Fatalf("ListArchivedControls returned %d rows, want %d", len(arch), len(want))
	}
	for i, w := range want {
		if arch[i].ID != w {
			got := make([]string, len(arch))
			for j, a := range arch {
				got[j] = a.ID
			}
			t.Fatalf("ListArchivedControls order = %v, want %v (deleted_at DESC, created_at DESC)", got, want)
		}
	}
}

// Issue #261: SoftDeleteControl guards on `deleted_at IS NULL`. A second call
// on an already-archived row does NOT clobber the original archive timestamp;
// it returns ErrControlNotFound (the row is invisible to the caller's list).
func TestSoftDeleteControlIsIdempotentAndPreservesTheOriginalTimestamp(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	c := newControl("CTRLSOFTIDEMP0000000000000", userID, nil)
	if err := store.CreateControl(ctx, c, []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}); err != nil {
		t.Fatalf("CreateControl: %v", err)
	}

	first := time.Unix(1_787_100_000, 0).UTC()
	if err := store.SoftDeleteControl(ctx, c.ID, first); err != nil {
		t.Fatalf("first SoftDeleteControl: %v", err)
	}

	second := time.Unix(1_787_900_000, 0).UTC()
	err := store.SoftDeleteControl(ctx, c.ID, second)
	if !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("second SoftDeleteControl on archived row: %v, want ErrControlNotFound", err)
	}

	got, err := store.ControlByID(ctx, c.ID)
	if err != nil {
		t.Fatalf("ControlByID: %v", err)
	}
	if got.DeletedAt == nil || !got.DeletedAt.Equal(first) {
		t.Errorf("DeletedAt = %v, want the original %v (second call must not overwrite)", got.DeletedAt, first)
	}
}

// Issue #261: RestoreControl guards symmetrically — a call on an already
// active row returns ErrControlNotFound. Positive path clears deleted_at.
func TestRestoreControlClearsDeletedAtAndRefusesActiveRows(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	c := newControl("CTRLRESTORE000000000000000", userID, nil)
	if err := store.CreateControl(ctx, c, []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}); err != nil {
		t.Fatalf("CreateControl: %v", err)
	}

	// Restore on an already-active row is refused.
	err := store.RestoreControl(ctx, c.ID)
	if !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("RestoreControl(active): %v, want ErrControlNotFound", err)
	}

	if err := store.SoftDeleteControl(ctx, c.ID, time.Unix(1_787_100_000, 0).UTC()); err != nil {
		t.Fatalf("SoftDeleteControl: %v", err)
	}
	if err := store.RestoreControl(ctx, c.ID); err != nil {
		t.Fatalf("RestoreControl(archived): %v", err)
	}
	got, err := store.ControlByID(ctx, c.ID)
	if err != nil {
		t.Fatalf("ControlByID: %v", err)
	}
	if got.DeletedAt != nil {
		t.Errorf("DeletedAt = %v after Restore, want nil", got.DeletedAt)
	}
}

// Issue #261: PurgeControl refuses an active row (defense-in-depth behind
// Service.Purge's ControlByID gate — a hand-typed URL that skipped Archive
// cannot destroy grades). The row survives; the caller sees
// ErrControlNotFound (nothing archived by that id).
func TestPurgeControlRefusesActiveRowsAndTheRowSurvives(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	c := newControl("CTRLPURGEACTIVE000000000AA", userID, nil)
	if err := store.CreateControl(ctx, c, []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}); err != nil {
		t.Fatalf("CreateControl: %v", err)
	}

	err := store.PurgeControl(ctx, c.ID)
	if !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("PurgeControl(active): %v, want ErrControlNotFound", err)
	}

	if _, err := store.ControlByID(ctx, c.ID); err != nil {
		t.Errorf("row survived guard? ControlByID: %v", err)
	}
}

// Issue #261: PurgeControl on an archived row hard-deletes it and every
// dependent — the FK cascades from ADR-0034 §Consequences do their job.
// Covers control_pregunta and copia (populated by CreateControl), plus
// job (populated here directly against the schema) so a future migration
// that changes the ON DELETE clause on job.control_id fails HERE rather
// than on the Jetson (Round-A COR-3).
func TestPurgeControlDeletesArchivedRowAndCascades(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)

	c := newControl("CTRLPURGEARCH000000000000A", userID, nil)
	if err := store.CreateControl(ctx, c, []controls.PoolEntry{
		{Ref: "q-if-1", Order: 0},
		{Ref: "q-bucles-1", Order: 1},
	}); err != nil {
		t.Fatalf("CreateControl: %v", err)
	}
	// Seed a job row directly so the cascade assertion covers it. The
	// jobstore package is not imported here on purpose — a raw INSERT
	// against the schema is what pins the schema itself.
	if _, err := db.ExecContext(ctx,
		`INSERT INTO job (control_id, kind, status, payload_json, created_at)
		 VALUES (?, 'generate', 'queued', '{}', ?)`,
		c.ID, time.Unix(1_787_050_000, 0).Unix(),
	); err != nil {
		t.Fatalf("seed job row: %v", err)
	}
	if err := store.SoftDeleteControl(ctx, c.ID, time.Unix(1_787_100_000, 0).UTC()); err != nil {
		t.Fatalf("SoftDeleteControl: %v", err)
	}

	if err := store.PurgeControl(ctx, c.ID); err != nil {
		t.Fatalf("PurgeControl(archived): %v", err)
	}

	if _, err := store.ControlByID(ctx, c.ID); !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("ControlByID after Purge: %v, want ErrControlNotFound", err)
	}
	for _, table := range []string{"control_pregunta", "copia", "job"} {
		var rows int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE control_id = ?", c.ID).Scan(&rows); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if rows != 0 {
			t.Errorf("%s still holds %d row(s) after purge, want 0 (FK cascade)", table, rows)
		}
	}
}

// Issue #261: PurgeControl on an id that never existed also returns
// ErrControlNotFound. Same shape as the active-row refusal — from the
// caller's perspective, "nothing archived by that id" is the truth.
func TestPurgeControlReturnsNotFoundForAnUnknownID(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)

	err := store.PurgeControl(ctx, "does-not-exist")
	if !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("PurgeControl(missing): %v, want ErrControlNotFound", err)
	}
}
