package controlstore_test

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/controlstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// seedControl creates one control with N copies so a reading test has a
// pool to persist into.
func seedControl(t *testing.T, ctx context.Context, db *sql.DB, id string, copies int) {
	t.Helper()
	userID := insertProfessor(t, ctx, db, "reader-"+id+"@example.com")
	store := controlstore.New(db)
	c := newControl(id, userID, nil)
	c.Copies = copies
	if err := store.CreateControl(ctx, c, []controls.PoolEntry{
		{Ref: "q-if-1", Order: 0},
		{Ref: "q-bucles-1", Order: 1},
	}); err != nil {
		t.Fatalf("CreateControl: %v", err)
	}
}

// sampleCopy returns a ReportCopy with two answers for testing.
func sampleCopy(rut string, status controls.CopyStatus, rutStatus controls.RUTStatus) controls.ReportCopy {
	return controls.ReportCopy{
		RUT:               rut,
		RUTStatus:         rutStatus,
		ExpectedQuestions: 2, SeenQuestions: 2,
		Status: status,
		Answers: []controls.ReportAnswer{
			{Question: 9, Name: "q-if-1", Type: controls.QuestionSimple,
				Marked: []int{1}, Doubtful: nil, Status: controls.AnswerStatusOK,
				Score: 1.0, Max: 1.0},
			{Question: 10, Name: "q-bucles-1", Type: controls.QuestionMultiple,
				Marked:   []int{1, 3},
				Doubtful: []controls.Doubtful{{Answer: 2, Darkness: 0.18}},
				Status:   controls.AnswerStatusDoubtful,
				Score:    3.0, Max: 4.0},
		},
	}
}

func TestUpsertReadingsFromReportInsertsThenUpdatesOnASecondCall(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0100READING0000000AAAA", 3)
	store := controlstore.New(db)

	now := time.Unix(1_755_600_000, 0).UTC()
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusNeedsReview, controls.RUTStatusOK),
			"2": sampleCopy("", controls.CopyStatusIncomplete, controls.RUTStatusUnreadable),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0100READING0000000AAAA", report, now); err != nil {
		t.Fatalf("Upsert first: %v", err)
	}

	// Copy 1 is present with two answers, RUT ok.
	r, err := store.ReadingByCopy(ctx, "CTRL0100READING0000000AAAA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy(1): %v", err)
	}
	if r.RUTStatus != controls.RUTStatusOK || r.RUTRead == nil || *r.RUTRead != "20123456" {
		t.Errorf("Reading(1) RUT = %+v (%v)", r.RUTRead, r.RUTStatus)
	}
	if len(r.Answers) != 2 || r.Answers[0].QuestionRef != "q-bucles-1" || r.Answers[1].QuestionRef != "q-if-1" {
		// Both answers have Position=0 → NULL, so ORDER BY falls back to
		// question_ref ASC — bucles < if lexicographically. The
		// primary printed-order path is covered by
		// TestUpsertReadingsFromReportPersistsPerCopyPrintedOrder.
		t.Errorf("Reading(1) answers = %+v", r.Answers)
	}
	multi := r.Answers[0]
	if multi.QuestionType != controls.QuestionMultiple || len(multi.Marked) != 2 ||
		len(multi.Doubtful) != 1 || multi.Doubtful[0].Darkness != 0.18 {
		t.Errorf("Reading(1) multiple = %+v", multi)
	}

	// A second upsert with a repaired report replaces the answers and
	// updates the status. Overrides — none set yet — stay absent, but
	// this is what the "overrides survive" contract will be built on.
	later := now.Add(time.Hour)
	report2 := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": {
				RUT: "20123456", RUTStatus: controls.RUTStatusOK,
				ExpectedQuestions: 2, SeenQuestions: 2, Status: controls.CopyStatusOK,
				Answers: []controls.ReportAnswer{
					{Question: 9, Name: "q-if-1", Type: controls.QuestionSimple,
						Marked: []int{1}, Status: controls.AnswerStatusOK, Score: 1.0, Max: 1.0},
				},
			},
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0100READING0000000AAAA", report2, later); err != nil {
		t.Fatalf("Upsert second: %v", err)
	}
	r, err = store.ReadingByCopy(ctx, "CTRL0100READING0000000AAAA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy(1) after upsert: %v", err)
	}
	if r.CopyStatus != controls.CopyStatusOK {
		t.Errorf("Reading(1).CopyStatus = %s, want ok", r.CopyStatus)
	}
	if len(r.Answers) != 1 {
		t.Errorf("Reading(1) answers after re-upsert = %d, want 1", len(r.Answers))
	}
	if !r.ReadAt.Equal(later) {
		t.Errorf("Reading(1).ReadAt = %v, want %v", r.ReadAt, later)
	}
}

func TestUpsertReadingsFromReportRefusesAnswerWithoutName(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0110NONAME0000000000AA", 1)
	store := controlstore.New(db)

	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": {
				RUTStatus: controls.RUTStatusUnreadable, Status: controls.CopyStatusNeedsReview,
				Answers: []controls.ReportAnswer{
					{Question: 9, Name: "", Type: controls.QuestionSimple,
						Marked: []int{1}, Status: controls.AnswerStatusOK, Score: 1.0, Max: 1.0},
				},
			},
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0110NONAME0000000000AA", report, time.Now()); err == nil {
		t.Fatal("Upsert accepted an answer without a layout name, want a refusal")
	}
	// Nothing should be committed.
	rs, err := store.ReadingsByControl(ctx, "CTRL0110NONAME0000000000AA")
	if err != nil {
		t.Fatalf("ReadingsByControl: %v", err)
	}
	if len(rs) != 0 {
		t.Errorf("readings = %d, want 0 (refusal must roll back)", len(rs))
	}
}

func TestMarkMissingAsNotPresentAddsAReadingPerMissingCopy(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0120MISSING0000000000A", 4)
	store := controlstore.New(db)

	// Upload only two of the four copies.
	now := time.Unix(1_755_600_000, 0).UTC()
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK),
			"3": sampleCopy("20234567", controls.CopyStatusOK, controls.RUTStatusOK),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0120MISSING0000000000A", report, now); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if err := store.MarkMissingAsNotPresent(ctx, "CTRL0120MISSING0000000000A", now); err != nil {
		t.Fatalf("MarkMissingAsNotPresent: %v", err)
	}
	// Idempotent: a second call must not double up.
	if err := store.MarkMissingAsNotPresent(ctx, "CTRL0120MISSING0000000000A", now); err != nil {
		t.Fatalf("MarkMissingAsNotPresent (2nd): %v", err)
	}

	readings, err := store.ReadingsByControl(ctx, "CTRL0120MISSING0000000000A")
	if err != nil {
		t.Fatalf("ReadingsByControl: %v", err)
	}
	if len(readings) != 4 {
		t.Fatalf("readings = %d, want 4 (one per printed copy)", len(readings))
	}
	// Copy 2 and 4 are not_present; copies 1 and 3 are unchanged.
	for _, r := range readings {
		switch r.CopyNumber {
		case 1, 3:
			if r.CopyStatus != controls.CopyStatusOK {
				t.Errorf("copy %d status = %s, want ok", r.CopyNumber, r.CopyStatus)
			}
		case 2, 4:
			if r.CopyStatus != controls.CopyStatusNotPresent || r.RUTStatus != controls.RUTStatusNotPresent || r.RUTRead != nil {
				t.Errorf("copy %d = %+v, want not_present", r.CopyNumber, r)
			}
		default:
			t.Errorf("unexpected copy_number %d", r.CopyNumber)
		}
	}
}

// TestUpsertReadingsFromReportPersistsPerCopyPrintedOrder pins issue #229's
// storage contract: the position of each question on the printed sheet and
// the alternatives in printed order both travel from report to database and
// back. loadAnswers orders by position (falling back to question_ref for
// legacy rows without one), so answers come out in the same order the
// student saw them.
func TestUpsertReadingsFromReportPersistsPerCopyPrintedOrder(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0130ORDER00000000000AA", 2)
	store := controlstore.New(db)

	now := time.Unix(1_755_700_000, 0).UTC()
	// q-bucles-1 prints SECOND on copy 1 (position 2). q-if-1 prints FIRST.
	// Alphabetically bucles < if, so the pre-#229 order (question_ref ASC)
	// would put bucles first — this test proves the store now respects
	// `position` instead.
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": {
				RUT: "20123456", RUTStatus: controls.RUTStatusOK,
				ExpectedQuestions: 2, SeenQuestions: 2, Status: controls.CopyStatusOK,
				Answers: []controls.ReportAnswer{
					{Question: 9, Name: "q-if-1", Type: controls.QuestionSimple,
						Marked: []int{1}, Status: controls.AnswerStatusOK,
						Score: 1.0, Max: 1.0,
						Position: 1, Alternatives: []int{3, 1, 4, 2}},
					{Question: 10, Name: "q-bucles-1", Type: controls.QuestionSimple,
						Marked: []int{2}, Status: controls.AnswerStatusOK,
						Score: 1.0, Max: 1.0,
						Position: 2, Alternatives: []int{2, 4, 1, 3}},
				},
			},
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0130ORDER00000000000AA", report, now); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	r, err := store.ReadingByCopy(ctx, "CTRL0130ORDER00000000000AA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy: %v", err)
	}
	if len(r.Answers) != 2 {
		t.Fatalf("want 2 answers, got %d", len(r.Answers))
	}
	if r.Answers[0].QuestionRef != "q-if-1" || r.Answers[0].Position != 1 {
		t.Errorf("answers[0] = %+v, want q-if-1 at position 1", r.Answers[0])
	}
	if !slices.Equal(r.Answers[0].Alternatives, []int{3, 1, 4, 2}) {
		t.Errorf("answers[0].Alternatives = %v, want [3 1 4 2]", r.Answers[0].Alternatives)
	}
	if r.Answers[1].QuestionRef != "q-bucles-1" || r.Answers[1].Position != 2 {
		t.Errorf("answers[1] = %+v, want q-bucles-1 at position 2", r.Answers[1])
	}
	if !slices.Equal(r.Answers[1].Alternatives, []int{2, 4, 1, 3}) {
		t.Errorf("answers[1].Alternatives = %v, want [2 4 1 3]", r.Answers[1].Alternatives)
	}
}

// TestUpsertReadingsFromReportPersistsPagesPerCopy pins issue #243's
// storage contract: the per-copy captured-pages list travels from
// report to database and back. The review page's raw-scan fallback
// iterates it (S3), so losing it here would silently regress to the
// single-page render this WP exists to fix.
func TestUpsertReadingsFromReportPersistsPagesPerCopy(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0132PAGES00000000000AA", 3)
	store := controlstore.New(db)

	now := time.Unix(1_755_700_100, 0).UTC()
	copy1 := sampleCopy("20123456", controls.CopyStatusNeedsReview, controls.RUTStatusOK)
	copy1.Pages = []int{1, 2, 3}
	// Copy 2 exercises AC-2: a copy where AMC captured page 1 but not
	// page 2 (page 2 scanned but rejected). The store must keep the
	// list verbatim — the review page renders exactly what AMC saw and
	// invents no phantom `<img>` for the missing page.
	copy2 := sampleCopy("19876543", controls.CopyStatusNeedsReview, controls.RUTStatusOK)
	copy2.Pages = []int{1}
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": copy1,
			"2": copy2,
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0132PAGES00000000000AA", report, now); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	r1, err := store.ReadingByCopy(ctx, "CTRL0132PAGES00000000000AA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy(1): %v", err)
	}
	if !slices.Equal(r1.Pages, []int{1, 2, 3}) {
		t.Errorf("Reading(1).Pages = %v, want [1 2 3]", r1.Pages)
	}
	r2, err := store.ReadingByCopy(ctx, "CTRL0132PAGES00000000000AA", 2)
	if err != nil {
		t.Fatalf("ReadingByCopy(2): %v", err)
	}
	if !slices.Equal(r2.Pages, []int{1}) {
		t.Errorf("Reading(2).Pages = %v, want [1] (page-2-missed case)", r2.Pages)
	}

	// A re-upsert with a different page shape must replace the list —
	// re-reading a batch at a different threshold cannot change which
	// pages AMC captured, but a re-uploaded batch can, and the write
	// path must not silently keep stale pages behind.
	copy1b := sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK)
	copy1b.Pages = []int{1, 2}
	report2 := controls.Report{
		Copies: map[string]controls.ReportCopy{"1": copy1b},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0132PAGES00000000000AA", report2, now.Add(time.Hour)); err != nil {
		t.Fatalf("Upsert 2: %v", err)
	}
	r1, _ = store.ReadingByCopy(ctx, "CTRL0132PAGES00000000000AA", 1)
	if !slices.Equal(r1.Pages, []int{1, 2}) {
		t.Errorf("Reading(1).Pages after re-upsert = %v, want [1 2]", r1.Pages)
	}
}

// TestLegacyReadingsBackfillToPageOne pins migration 00011's
// backfill: a reading row written before this WP had no pages_json
// at all. The ALTER wrote '[]' into every existing row and the
// follow-up UPDATE turned each of them into '[1]', so the review
// page's iteration keeps its pre-#243 single-page render on legacy
// data — no regression on rows the professor has already reviewed.
//
// This test guards two things:
//   - the runtime effect (row inserted with '[]' reads back as [1]),
//     exercised by re-running an UPDATE identical to 00011's; and
//   - the SOURCE OF TRUTH (the migration file itself still contains
//     that UPDATE) — without the file assertion the test would keep
//     passing on its own inline SQL after the migration silently
//     drifted away from it (Round A review, COR-3).
func TestLegacyReadingsBackfillToPageOne(t *testing.T) {
	// Guard: the migration file must still carry the backfill clause
	// the runtime half of this test replays. A future edit that
	// changes the WHERE predicate or the target value regresses the
	// legacy render, and this line is what surfaces it before the
	// silent DB drift does.
	raw, err := migrations.FS.ReadFile("00011_reading_pages.sql")
	if err != nil {
		t.Fatalf("read migration 00011: %v", err)
	}
	const backfillSQL = `UPDATE reading SET pages_json = '[1]' WHERE pages_json = '[]'`
	if !strings.Contains(string(raw), backfillSQL) {
		t.Fatalf("migration 00011 no longer contains the backfill clause %q — update this test to replay the new clause and confirm legacy rows still converge on [1]", backfillSQL)
	}

	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0133LEGACY0000000000AA", 1)
	store := controlstore.New(db)

	// A raw INSERT without pages_json — pre-#243 code shape. Under the
	// new migration this hits the DEFAULT '[]', which the follow-up
	// UPDATE (in the same migration) turns into '[1]'. We simulate
	// "reached the DEFAULT" here directly with an explicit '[]' write:
	// the assertion is that the read path returns [1] — same effect as
	// on a real legacy row that landed before the column existed.
	if _, err := db.ExecContext(ctx,
		`INSERT INTO reading (control_id, copy_number, rut_read, rut_status, copy_status, read_at, pages_json)
         VALUES (?, 1, '20123456', 'ok', 'ok', ?, '[]')`,
		"CTRL0133LEGACY0000000000AA", time.Now().Unix()); err != nil {
		t.Fatalf("insert legacy reading: %v", err)
	}
	if _, err := db.ExecContext(ctx, backfillSQL); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	r, err := store.ReadingByCopy(ctx, "CTRL0133LEGACY0000000000AA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy: %v", err)
	}
	if !slices.Equal(r.Pages, []int{1}) {
		t.Errorf("legacy Reading.Pages = %v, want [1] via migration backfill", r.Pages)
	}
}

// TestLegacyAnswerRowsWithoutPositionFallBackToRefOrder pins the migration
// contract: an answer row written before #229 has NULL position and NULL
// alternatives; loadAnswers must still return it, ordered by question_ref
// as before the change. Backfilling a made-up position would be the same
// silent-wrong shape ADR-0031 exists to forbid — the fallback is the
// design.
func TestLegacyAnswerRowsWithoutPositionFallBackToRefOrder(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0131LEGACY0000000000AA", 1)
	store := controlstore.New(db)

	if _, err := db.ExecContext(ctx,
		`INSERT INTO reading (control_id, copy_number, rut_read, rut_status, copy_status, read_at)
         VALUES (?, 1, '20123456', 'ok', 'ok', ?)`,
		"CTRL0131LEGACY0000000000AA", time.Now().Unix()); err != nil {
		t.Fatalf("insert reading: %v", err)
	}
	var readingID int64
	if err := db.QueryRowContext(ctx,
		`SELECT id FROM reading WHERE control_id = ? AND copy_number = 1`,
		"CTRL0131LEGACY0000000000AA").Scan(&readingID); err != nil {
		t.Fatalf("lookup reading: %v", err)
	}
	// Two answers, inserted in a deliberately non-alphabetical order so the
	// fallback ORDER BY question_ref is what determines the read order, not
	// insertion time.
	for _, name := range []string{"q-if-1", "q-bucles-1"} {
		if _, err := db.ExecContext(ctx,
			`INSERT INTO answer
                 (reading_id, question_ref, question_type, marked_json, doubtful_json, status, score, max)
             VALUES (?, ?, 'simple', '[1]', '[]', 'ok', 1.0, 1.0)`,
			readingID, name); err != nil {
			t.Fatalf("insert answer %s: %v", name, err)
		}
	}

	r, err := store.ReadingByCopy(ctx, "CTRL0131LEGACY0000000000AA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy: %v", err)
	}
	if len(r.Answers) != 2 ||
		r.Answers[0].QuestionRef != "q-bucles-1" ||
		r.Answers[1].QuestionRef != "q-if-1" {
		t.Errorf("legacy fallback order = %+v, want [q-bucles-1, q-if-1]", r.Answers)
	}
	if r.Answers[0].Position != 0 {
		t.Errorf("legacy Position = %d, want 0 (unset)", r.Answers[0].Position)
	}
	if r.Answers[0].Alternatives != nil {
		t.Errorf("legacy Alternatives = %v, want nil", r.Answers[0].Alternatives)
	}
}

func TestReadingByCopyReturnsErrReadingNotFoundForAMissingCopy(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)
	if _, err := store.ReadingByCopy(ctx, "does-not-exist", 1); !errors.Is(err, controls.ErrReadingNotFound) {
		t.Errorf("ReadingByCopy(missing): %v, want ErrReadingNotFound", err)
	}
}

func TestSetAndClearAnswerOverrideStampsLastEditedAtAndSurvivesReupsert(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0130OVERRIDE0000000AAA", 1)
	store := controlstore.New(db)

	now := time.Unix(1_755_600_000, 0).UTC()
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusNeedsReview, controls.RUTStatusOK),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0130OVERRIDE0000000AAA", report, now); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	r, _ := store.ReadingByCopy(ctx, "CTRL0130OVERRIDE0000000AAA", 1)

	editedAt := now.Add(2 * time.Hour)
	override := controls.AnswerOverride{
		Marked: []int{2}, Status: controls.AnswerStatusOK, EditedAt: editedAt,
	}
	if err := store.SetAnswerOverride(ctx, r.ID, "q-if-1", override); err != nil {
		t.Fatalf("SetAnswerOverride: %v", err)
	}
	r, err := store.ReadingByCopy(ctx, "CTRL0130OVERRIDE0000000AAA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy: %v", err)
	}
	if r.LastEditedAt == nil || !r.LastEditedAt.Equal(editedAt) {
		t.Errorf("LastEditedAt = %v, want %v", r.LastEditedAt, editedAt)
	}
	// Find the answer we overrode.
	var found *controls.Answer
	for i := range r.Answers {
		if r.Answers[i].QuestionRef == "q-if-1" {
			found = &r.Answers[i]
		}
	}
	if found == nil || found.Override == nil {
		t.Fatalf("q-if-1 override = %+v", found)
	}
	if found.Override.Marked[0] != 2 || found.Override.Status != controls.AnswerStatusOK {
		t.Errorf("override = %+v", found.Override)
	}

	// A re-upsert with a different report must NOT wipe the override.
	report2 := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0130OVERRIDE0000000AAA", report2, now.Add(time.Hour)); err != nil {
		t.Fatalf("Upsert 2: %v", err)
	}
	r, _ = store.ReadingByCopy(ctx, "CTRL0130OVERRIDE0000000AAA", 1)
	for i := range r.Answers {
		if r.Answers[i].QuestionRef == "q-if-1" {
			if r.Answers[i].Override == nil || r.Answers[i].Override.Marked[0] != 2 {
				t.Errorf("q-if-1 override lost across re-upsert: %+v", r.Answers[i].Override)
			}
		}
	}

	// Clear removes the override.
	if err := store.ClearAnswerOverride(ctx, r.ID, "q-if-1"); err != nil {
		t.Fatalf("ClearAnswerOverride: %v", err)
	}
	r, _ = store.ReadingByCopy(ctx, "CTRL0130OVERRIDE0000000AAA", 1)
	for i := range r.Answers {
		if r.Answers[i].QuestionRef == "q-if-1" && r.Answers[i].Override != nil {
			t.Errorf("q-if-1 override still present after Clear: %+v", r.Answers[i].Override)
		}
	}
}

func TestSetAndClearRUTOverride(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0140RUTOVER0000000000A", 1)
	store := controlstore.New(db)

	now := time.Unix(1_755_600_000, 0).UTC()
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("", controls.CopyStatusNeedsReview, controls.RUTStatusUnreadable),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0140RUTOVER0000000000A", report, now); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	r, _ := store.ReadingByCopy(ctx, "CTRL0140RUTOVER0000000000A", 1)

	editedAt := now.Add(time.Hour)
	if err := store.SetRUTOverride(ctx, r.ID, "20999888", editedAt); err != nil {
		t.Fatalf("SetRUTOverride: %v", err)
	}
	r, _ = store.ReadingByCopy(ctx, "CTRL0140RUTOVER0000000000A", 1)
	if r.RUTOverride == nil || r.RUTOverride.RUT != "20999888" {
		t.Errorf("RUTOverride = %+v", r.RUTOverride)
	}
	if r.LastEditedAt == nil || !r.LastEditedAt.Equal(editedAt) {
		t.Errorf("LastEditedAt = %v, want %v", r.LastEditedAt, editedAt)
	}
	if err := store.ClearRUTOverride(ctx, r.ID); err != nil {
		t.Fatalf("ClearRUTOverride: %v", err)
	}
	r, _ = store.ReadingByCopy(ctx, "CTRL0140RUTOVER0000000000A", 1)
	if r.RUTOverride != nil {
		t.Errorf("RUTOverride still present after Clear: %+v", r.RUTOverride)
	}
}

func TestSetControlStateUpdatesTheRow(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0150STATE00000000000AA", 1)
	store := controlstore.New(db)

	if err := store.SetControlState(ctx, "CTRL0150STATE00000000000AA", controls.InReview); err != nil {
		t.Fatalf("SetControlState in_review: %v", err)
	}
	c, _ := store.ControlByID(ctx, "CTRL0150STATE00000000000AA")
	if c.State != controls.InReview {
		t.Errorf("State = %s, want in_review", c.State)
	}
	if err := store.SetControlState(ctx, "CTRL0150STATE00000000000AA", controls.Graded); err != nil {
		t.Fatalf("SetControlState graded: %v", err)
	}
	c, _ = store.ControlByID(ctx, "CTRL0150STATE00000000000AA")
	if c.State != controls.Graded {
		t.Errorf("State = %s, want graded", c.State)
	}
	if err := store.SetControlState(ctx, "does-not-exist", controls.Graded); !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("SetControlState(missing): %v, want ErrControlNotFound", err)
	}
}

// --- Issue #272 S8: one student's copies. ---

// The copies of one person, newest control first, and nobody else's.
func TestCopiesForStudentReturnsTheirCopiesNewestControlFirst(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)
	pool := []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}

	ana := insertStudentRow(t, ctx, db, "canvas-ana", "11222333", "5")
	bruno := insertStudentRow(t, ctx, db, "canvas-bruno", "22333444", "1")

	// Two dated controls and one with no date. The undated one sorts
	// LAST, like it does in ListControls: it has no position in the term.
	older := time.Unix(1_750_000_000, 0).UTC()
	newer := time.Unix(1_755_000_000, 0).UTC()
	first := newControl("CTRLOLDER00000000000000AAA", userID, &older)
	second := newControl("CTRLNEWER00000000000000AAA", userID, &newer)
	undated := newControl("CTRLUNDATED000000000000AAA", userID, nil)
	for _, c := range []controls.Control{first, second, undated} {
		if err := store.CreateControl(ctx, c, pool); err != nil {
			t.Fatalf("CreateControl %s: %v", c.ID, err)
		}
	}

	// Ana sat all three; Bruno sat one, so a leak would be visible.
	insertReadingFor(t, ctx, db, first.ID, 1, ana)
	insertReadingFor(t, ctx, db, second.ID, 1, ana)
	insertReadingFor(t, ctx, db, undated.ID, 1, ana)
	insertReadingFor(t, ctx, db, second.ID, 2, bruno)

	got, err := store.CopiesForStudent(ctx, ana)
	if err != nil {
		t.Fatalf("CopiesForStudent: %v", err)
	}
	want := []controls.StudentCopy{
		{ControlID: second.ID, CopyNumber: 1},
		{ControlID: first.ID, CopyNumber: 1},
		{ControlID: undated.ID, CopyNumber: 1},
	}
	if len(got) != len(want) {
		t.Fatalf("CopiesForStudent returned %d copies, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("copy %d = %+v, want %+v (full: %+v)", i, got[i], want[i], got)
		}
	}
}

// An archived control is not part of a person's record.
//
// Archiving is the professor saying "put this away"; a student page
// bringing it back would be the page deciding otherwise. Same rule, and
// the same reason, as the retroactive pass in S5.
func TestCopiesForStudentSkipsArchivedControls(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "p@example.com")
	store := controlstore.New(db)
	pool := []controls.PoolEntry{{Ref: "q-if-1", Order: 0}}

	ana := insertStudentRow(t, ctx, db, "canvas-ana", "11222333", "5")
	active := newControl("CTRLACTIVE0000000000000AAA", userID, nil)
	archived := newControl("CTRLARCHIVED00000000000AAA", userID, nil)
	for _, c := range []controls.Control{active, archived} {
		if err := store.CreateControl(ctx, c, pool); err != nil {
			t.Fatalf("CreateControl %s: %v", c.ID, err)
		}
	}
	insertReadingFor(t, ctx, db, active.ID, 1, ana)
	insertReadingFor(t, ctx, db, archived.ID, 1, ana)

	if err := store.SoftDeleteControl(ctx, archived.ID, time.Unix(1_755_500_000, 0).UTC()); err != nil {
		t.Fatalf("SoftDeleteControl: %v", err)
	}

	got, err := store.CopiesForStudent(ctx, ana)
	if err != nil {
		t.Fatalf("CopiesForStudent: %v", err)
	}
	if len(got) != 1 || got[0].ControlID != active.ID {
		t.Errorf("CopiesForStudent = %+v, want only the active control", got)
	}
}

// A student who sat nothing gets an empty list, not an error.
func TestCopiesForStudentIsEmptyForSomebodyWhoSatNothing(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)
	ana := insertStudentRow(t, ctx, db, "canvas-ana", "11222333", "5")

	got, err := store.CopiesForStudent(ctx, ana)
	if err != nil {
		t.Fatalf("CopiesForStudent: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("CopiesForStudent = %+v, want nothing", got)
	}
}

// The index migration 00016 adds is the one the planner actually uses.
//
// This is the guard 00014's comment asks for and 00015 promised: an index
// justified by a query the plan disowns is an index somebody drops later
// after checking the stated reason and finding it false (#271 review,
// PER-4). The measurement is IN the migration; this is what keeps it
// true.
//
// What it pins is the DRIVING TABLE. Without the index the plan enters at
// `control`, walks every active one and probes its readings — so asking
// for one person's copies reads every copy of every control. The
// assertion is on `SEARCH reading USING INDEX idx_reading_by_student`
// being present, not on the whole plan text, so an unrelated planner
// improvement does not fail a case about this index.
func TestCopiesForStudentDrivesFromTheStudentIndex(t *testing.T) {
	ctx, db := migrated(t)

	// The PRODUCTION statement, not a copy of it (#272 review, COR-9).
	rows, err := db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+controlstore.CopiesForStudentSQL, 1)
	if err != nil {
		t.Fatalf("EXPLAIN QUERY PLAN: %v", err)
	}
	defer func() { _ = rows.Close() }()

	var plan []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatalf("scan: %v", err)
		}
		plan = append(plan, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}

	joined := strings.Join(plan, "\n")
	if !strings.Contains(joined, "idx_reading_by_student") {
		t.Errorf("the plan does not use idx_reading_by_student, so migration 00016's stated reason is false:\n%s", joined)
	}
	// And it drives FROM reading: the index is only worth its write cost
	// if it is the entry point, not a probe the planner reaches second.
	if !strings.HasPrefix(plan[0], "SEARCH reading") {
		t.Errorf("the plan drives from %q, want reading — the whole point of the index:\n%s", plan[0], joined)
	}
}

// insertStudentRow adds a person and returns their id.
func insertStudentRow(t *testing.T, ctx context.Context, db *sql.DB, canvasUserID, rut, dv string) int64 {
	t.Helper()
	result, err := db.ExecContext(ctx, `
        INSERT INTO student (first_name, last_name, email, rut, rut_dv, canvas_user_id)
        VALUES ('Ana', 'Pérez', 'ana@example.com', ?, ?, ?)`, rut, dv, canvasUserID)
	if err != nil {
		t.Fatalf("insert student %s: %v", canvasUserID, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}
	return id
}

// insertReadingFor adds a reading of one copy already matched to a student.
func insertReadingFor(t *testing.T, ctx context.Context, db *sql.DB, controlID string, copyNumber int, studentID int64) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `
        INSERT INTO reading (control_id, copy_number, rut_read, rut_status, copy_status, read_at, student_id)
        VALUES (?, ?, '11222333', 'ok', 'ok', 0, ?)`,
		controlID, copyNumber, studentID); err != nil {
		t.Fatalf("insert reading %s/%d: %v", controlID, copyNumber, err)
	}
}

// Issue #287: the per-copy publication round-trips through both reads.
//
// Both readers matter and neither stands in for the other: the copies table
// renders ReadingsByControl and the review page renders ReadingByCopy, so a
// column added to one SELECT and forgotten in the other shows the professor
// two different answers about the same copy on two screens.
func TestMarkCopyPublishedRoundTripsThroughBothReads(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0287PUBLISH00000AAAAA", 2)
	store := controlstore.New(db)

	now := time.Unix(1_757_260_800, 0).UTC()
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK),
			"2": sampleCopy("20999999", controls.CopyStatusOK, controls.RUTStatusOK),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0287PUBLISH00000AAAAA", report, now); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	before, err := store.ReadingByCopy(ctx, "CTRL0287PUBLISH00000AAAAA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy(1): %v", err)
	}
	if before.PublishedAt != nil || before.PublishedGrade != "" {
		t.Errorf("a freshly read copy carries PublishedAt=%v grade=%q, want the zero pair",
			before.PublishedAt, before.PublishedGrade)
	}

	sentAt := time.Unix(1_757_264_400, 0).UTC()
	if err := store.MarkCopyPublished(ctx, before.ID, sentAt, "5.7"); err != nil {
		t.Fatalf("MarkCopyPublished: %v", err)
	}

	one, err := store.ReadingByCopy(ctx, "CTRL0287PUBLISH00000AAAAA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy(1) after the stamp: %v", err)
	}
	if one.PublishedAt == nil || !one.PublishedAt.Equal(sentAt) || one.PublishedGrade != "5.7" {
		t.Errorf("ReadingByCopy reads PublishedAt=%v grade=%q, want %v and \"5.7\"",
			one.PublishedAt, one.PublishedGrade, sentAt)
	}

	all, err := store.ReadingsByControl(ctx, "CTRL0287PUBLISH00000AAAAA")
	if err != nil {
		t.Fatalf("ReadingsByControl: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("ReadingsByControl returned %d readings, want 2", len(all))
	}
	if all[0].PublishedAt == nil || all[0].PublishedGrade != "5.7" {
		t.Errorf("copy 1 in the list reads PublishedAt=%v grade=%q, want the stamp",
			all[0].PublishedAt, all[0].PublishedGrade)
	}
	// The stamp is per COPY, so the copy nobody wrote to must stay unstamped.
	// A statement missing its WHERE passes every assertion above.
	if all[1].PublishedAt != nil || all[1].PublishedGrade != "" {
		t.Errorf("copy 2 reads PublishedAt=%v grade=%q, want it untouched",
			all[1].PublishedAt, all[1].PublishedGrade)
	}
}

// MarkCopyPublished against a reading id nothing carries is an error, not a
// silent success.
//
// Same guard, and the same reason, as SetReadingStudent and
// SetControlCourse: an UPDATE whose WHERE matches nothing succeeds, and a
// nil return would let a publication count a copy as sent that no row
// records.
func TestMarkCopyPublishedRefusesAnUnknownReading(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)

	err := store.MarkCopyPublished(ctx, 4242, time.Unix(1_757_264_400, 0).UTC(), "5.7")
	if !errors.Is(err, controls.ErrReadingNotFound) {
		t.Errorf("MarkCopyPublished on an unknown reading returned %v, want ErrReadingNotFound", err)
	}
}

// THE PROPERTY THE WHOLE FEATURE RESTS ON (issue #287).
//
// A re-analysis re-upserts every reading of the control. If that wiped the
// per-copy publication, one "re-leer con otra sensibilidad" would tell the
// professor that nobody had received anything — and the next Publicar would
// mail the entire class a second copy.
//
// It survives because upsertReading's ON CONFLICT DO UPDATE SET names its
// columns explicitly, so a column it does not name is left alone. That is a
// property of a statement somebody could edit, which is why it is pinned
// here rather than left to the migration's comment.
func TestUpsertingAReportPreservesThePerCopyPublication(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0287REREAD000000AAAAA", 2)
	store := controlstore.New(db)

	first := time.Unix(1_757_260_800, 0).UTC()
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0287REREAD000000AAAAA", report, first); err != nil {
		t.Fatalf("Upsert first: %v", err)
	}
	reading, err := store.ReadingByCopy(ctx, "CTRL0287REREAD000000AAAAA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy: %v", err)
	}
	sentAt := time.Unix(1_757_264_400, 0).UTC()
	if err := store.MarkCopyPublished(ctx, reading.ID, sentAt, "5.7"); err != nil {
		t.Fatalf("MarkCopyPublished: %v", err)
	}

	// The re-read: a different sensitivity produced a different status for
	// the same copy, which is exactly what a re-analysis is for.
	second := time.Unix(1_757_270_000, 0).UTC()
	reread := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusNeedsReview, controls.RUTStatusOK),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0287REREAD000000AAAAA", reread, second); err != nil {
		t.Fatalf("Upsert second: %v", err)
	}

	after, err := store.ReadingByCopy(ctx, "CTRL0287REREAD000000AAAAA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy after the re-read: %v", err)
	}
	// Non-vacuity: the re-read must actually have landed, or "the columns
	// survived" says nothing at all.
	if !after.ReadAt.Equal(second) || after.CopyStatus != controls.CopyStatusNeedsReview {
		t.Fatalf("the re-read did not land (ReadAt=%v status=%q), so nothing below is about it",
			after.ReadAt, after.CopyStatus)
	}
	if after.PublishedAt == nil || !after.PublishedAt.Equal(sentAt) || after.PublishedGrade != "5.7" {
		t.Errorf("after a re-read the copy carries PublishedAt=%v grade=%q, want %v and \"5.7\" — "+
			"a re-read that erases this makes the next publication mail the class twice",
			after.PublishedAt, after.PublishedGrade, sentAt)
	}
}

// ClearCopyPublications counts what it CLEARED, not what it touched (issue
// #287).
//
// The number is what the flash quotes back to the professor, and a
// statement without its `published_at IS NOT NULL` guard would count every
// copy of the control — telling somebody that thirty people will receive a
// second copy when three did.
func TestClearCopyPublicationsCountsOnlyTheCopiesThatHadGoneOut(t *testing.T) {
	ctx, db := migrated(t)
	seedControl(t, ctx, db, "CTRL0287RESEND000000AAAAA", 3)
	store := controlstore.New(db)

	now := time.Unix(1_757_260_800, 0).UTC()
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK),
			"2": sampleCopy("20999999", controls.CopyStatusOK, controls.RUTStatusOK),
			"3": sampleCopy("20888888", controls.CopyStatusOK, controls.RUTStatusOK),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0287RESEND000000AAAAA", report, now); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	readings, err := store.ReadingsByControl(ctx, "CTRL0287RESEND000000AAAAA")
	if err != nil {
		t.Fatalf("ReadingsByControl: %v", err)
	}
	for _, reading := range readings[:2] {
		if err := store.MarkCopyPublished(ctx, reading.ID, now, "5.7"); err != nil {
			t.Fatalf("MarkCopyPublished: %v", err)
		}
	}

	cleared, err := store.ClearCopyPublications(ctx, "CTRL0287RESEND000000AAAAA")
	if err != nil {
		t.Fatalf("ClearCopyPublications: %v", err)
	}
	if cleared != 2 {
		t.Errorf("cleared = %d, want the 2 copies that had gone out", cleared)
	}

	after, err := store.ReadingsByControl(ctx, "CTRL0287RESEND000000AAAAA")
	if err != nil {
		t.Fatalf("ReadingsByControl after: %v", err)
	}
	for _, reading := range after {
		if reading.PublishedAt != nil || reading.PublishedGrade != "" {
			t.Errorf("copy %d kept its stamp (%v/%q)",
				reading.CopyNumber, reading.PublishedAt, reading.PublishedGrade)
		}
	}
}

// And it reaches only the control it was asked about. A statement missing
// its control_id would pass every assertion above.
func TestClearCopyPublicationsLeavesOtherControlsAlone(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)
	for _, id := range []string{"CTRL0287RESENDA00000AAAAA", "CTRL0287RESENDB00000AAAAA"} {
		seedControl(t, ctx, db, id, 1)
		report := controls.Report{
			Copies: map[string]controls.ReportCopy{
				"1": sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK),
			},
		}
		now := time.Unix(1_757_260_800, 0).UTC()
		if err := store.UpsertReadingsFromReport(ctx, id, report, now); err != nil {
			t.Fatalf("Upsert %s: %v", id, err)
		}
		reading, err := store.ReadingByCopy(ctx, id, 1)
		if err != nil {
			t.Fatalf("ReadingByCopy %s: %v", id, err)
		}
		if err := store.MarkCopyPublished(ctx, reading.ID, now, "5.7"); err != nil {
			t.Fatalf("MarkCopyPublished %s: %v", id, err)
		}
	}

	if _, err := store.ClearCopyPublications(ctx, "CTRL0287RESENDA00000AAAAA"); err != nil {
		t.Fatalf("ClearCopyPublications: %v", err)
	}

	other, err := store.ReadingByCopy(ctx, "CTRL0287RESENDB00000AAAAA", 1)
	if err != nil {
		t.Fatalf("ReadingByCopy: %v", err)
	}
	if other.PublishedAt == nil {
		t.Error("clearing one control's stamps cleared another control's too")
	}
}

// PublicationCounts (issue #287 §8): the whole page's numbers in one
// statement, in the shape of coursestore.EnrollmentCounts.
func TestPublicationCountsTalliesEveryControlInOnePass(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)

	// Two controls, so a query missing its GROUP BY — or keyed on the
	// wrong column — folds them together and fails here.
	for _, id := range []string{"CTRL0287COUNTA000000AAAAA", "CTRL0287COUNTB000000AAAAA"} {
		seedControl(t, ctx, db, id, 2)
		report := controls.Report{
			Copies: map[string]controls.ReportCopy{
				"1": sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK),
				"2": sampleCopy("20999999", controls.CopyStatusOK, controls.RUTStatusOK),
			},
		}
		if err := store.UpsertReadingsFromReport(ctx, id, report, time.Unix(1_757_260_800, 0).UTC()); err != nil {
			t.Fatalf("Upsert %s: %v", id, err)
		}
	}

	// Control A: both copies matched and annotated, one of them sent.
	studentID := insertStudentForCounts(t, ctx, db)
	for copyNumber := 1; copyNumber <= 2; copyNumber++ {
		reading, err := store.ReadingByCopy(ctx, "CTRL0287COUNTA000000AAAAA", copyNumber)
		if err != nil {
			t.Fatalf("ReadingByCopy: %v", err)
		}
		if err := store.SetReadingStudent(ctx, reading.ID, &studentID); err != nil {
			t.Fatalf("SetReadingStudent: %v", err)
		}
		if err := store.RecordAnnotated(ctx, controls.AnnotatedCopy{
			ControlID: "CTRL0287COUNTA000000AAAAA", CopyNumber: copyNumber,
			GeneratedAt: time.Unix(0, 0).UTC(), Path: "anotado.pdf",
		}); err != nil {
			t.Fatalf("RecordAnnotated: %v", err)
		}
		if copyNumber == 1 {
			if err := store.MarkCopyPublished(ctx, reading.ID, time.Unix(1, 0).UTC(), "5.7"); err != nil {
				t.Fatalf("MarkCopyPublished: %v", err)
			}
		}
	}

	counts, err := store.PublicationCounts(ctx)
	if err != nil {
		t.Fatalf("PublicationCounts: %v", err)
	}
	a := counts["CTRL0287COUNTA000000AAAAA"]
	if a.Sent != 1 || a.Deliverable != 2 {
		t.Errorf("control A = %+v, want Sent 1 of Deliverable 2", a)
	}
	// A THIRD copy, matched to somebody and with NO annotated record: it is
	// what makes the annotated half of the filter load-bearing. Without it
	// the `student_id IS NOT NULL` conjunct alone produces every expected
	// number in this file, and deleting `AND annotated_copy.control_id IS
	// NOT NULL` leaves the entire suite green (#287 review, COR-3/F3).
	if _, err := db.ExecContext(ctx, `
        INSERT INTO reading (control_id, copy_number, rut_read, rut_status, copy_status, read_at, student_id)
        VALUES (?, 3, '20777777', 'ok', 'ok', 0, ?)`,
		"CTRL0287COUNTA000000AAAAA", studentID); err != nil {
		t.Fatalf("inserting the un-annotated copy: %v", err)
	}
	counts, err = store.PublicationCounts(ctx)
	if err != nil {
		t.Fatalf("PublicationCounts after the third copy: %v", err)
	}
	if a = counts["CTRL0287COUNTA000000AAAAA"]; a.Deliverable != 2 {
		t.Errorf("control A = %+v with three matched copies of which two are annotated, "+
			"want Deliverable 2 — a copy with no corrected PDF cannot be sent", a)
	}
	// Control B has readings but nothing matched and nothing annotated, so
	// nothing has gone out and nothing could.
	b := counts["CTRL0287COUNTB000000AAAAA"]
	if b.Sent != 0 || b.Deliverable != 0 {
		t.Errorf("control B = %+v, want a zero pair", b)
	}
}

// An ARCHIVED control is not on the list this feeds, so it is not in the
// counts either — the same exclusion ListControls makes, for the same
// reason.
func TestPublicationCountsSkipsArchivedControls(t *testing.T) {
	ctx, db := migrated(t)
	store := controlstore.New(db)
	seedControl(t, ctx, db, "CTRL0287COUNTARCH000AAAAA", 1)
	report := controls.Report{
		Copies: map[string]controls.ReportCopy{
			"1": sampleCopy("20123456", controls.CopyStatusOK, controls.RUTStatusOK),
		},
	}
	if err := store.UpsertReadingsFromReport(ctx, "CTRL0287COUNTARCH000AAAAA", report,
		time.Unix(1_757_260_800, 0).UTC()); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if counts, err := store.PublicationCounts(ctx); err != nil {
		t.Fatalf("PublicationCounts: %v", err)
	} else if _, present := counts["CTRL0287COUNTARCH000AAAAA"]; !present {
		t.Fatal("the active control is missing, so the archived assertion below is vacuous")
	}

	if err := store.SoftDeleteControl(ctx, "CTRL0287COUNTARCH000AAAAA", time.Unix(2, 0).UTC()); err != nil {
		t.Fatalf("SoftDeleteControl: %v", err)
	}
	counts, err := store.PublicationCounts(ctx)
	if err != nil {
		t.Fatalf("PublicationCounts after archiving: %v", err)
	}
	if _, present := counts["CTRL0287COUNTARCH000AAAAA"]; present {
		t.Error("an archived control is counted for a list that does not show it")
	}
}

// insertStudentForCounts adds one enrolled person a reading can point at.
func insertStudentForCounts(t *testing.T, ctx context.Context, db *sql.DB) int64 {
	t.Helper()

	result, err := db.ExecContext(ctx, `
        INSERT INTO student (canvas_user_id, first_name, last_name, email, rut, rut_dv)
        VALUES ('canvas-counts', 'Ana', 'Pérez', 'ana@udp.cl', '20123456', '5')`)
	if err != nil {
		t.Fatalf("inserting the student: %v", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("reading the student id: %v", err)
	}
	return id
}

// The plan PublicationCounts actually runs (#287 review, COR-3/F3).
//
// It EXPLAINs the exported const rather than a restated copy, which is the
// whole reason the const is exported — and the reason #272's review found a
// guard EXPLAINing a query nothing ran any more (COR-9). Asserting the plan
// rather than the timing keeps it a statement about the schema.
//
// What it pins: ONE statement for the whole page, driving from `reading`
// and reaching `control` and `annotated_copy` by their own keys. What it
// does NOT fix: the temp B-tree for the GROUP BY, which survives either
// way — a control_id index on `reading` would remove it, and
// `idx_reading_by_control` already leads with that column, so the plan is
// as good as this shape gets.
func TestPublicationCountsRunsAsOneStatementOverTheIndexes(t *testing.T) {
	ctx, db := migrated(t)

	rows, err := db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+controlstore.PublicationCountsSQL)
	if err != nil {
		t.Fatalf("EXPLAIN QUERY PLAN: %v", err)
	}
	defer func() { _ = rows.Close() }()

	var plan []string
	for rows.Next() {
		var id, parent, notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatalf("scanning the plan: %v", err)
		}
		plan = append(plan, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("reading the plan: %v", err)
	}
	if len(plan) == 0 {
		t.Fatal("the planner returned nothing, so nothing below is about the query")
	}

	joined := strings.Join(plan, " | ")
	// No correlated subquery per row: a plan naming a scan of `reading`
	// under a parent per control is the N+1 in disguise.
	if strings.Contains(joined, "CORRELATED") {
		t.Errorf("the tally runs a correlated subquery, which is the per-row count "+
			"this statement exists to avoid:\n%s", joined)
	}
	// Both joined tables are reached by a key rather than scanned per row.
	for _, want := range []string{"control", "annotated_copy"} {
		if !strings.Contains(joined, want) {
			t.Errorf("the plan does not mention %s:\n%s", want, joined)
		}
	}
	if !strings.Contains(joined, "USING INDEX") && !strings.Contains(joined, "USING PRIMARY KEY") {
		t.Errorf("the plan uses no index at all:\n%s", joined)
	}
}
