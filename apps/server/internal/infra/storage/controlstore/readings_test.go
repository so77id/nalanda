package controlstore_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/controlstore"
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
		// ORDER BY question_ref ASC — bucles < if lexicographically.
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
