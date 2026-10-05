package surveystore_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// What a run's scans produced (issue #311 S1), against the real schema.

// readable is a survey with two single-choice questions and a run of it.
func (f *fixture) readable(t *testing.T) (survey.Run, survey.Question, survey.Question) {
	t.Helper()
	s := f.createSurvey(t, "Banco")
	q1 := f.add(t, s.ID, single("¿1?", "A", "B", "C"))
	q2 := f.add(t, s.ID, single("¿2?", "A", "B"))
	return f.createRun(t, s), q1, q2
}

func TestSaveReadingsStoresCopiesMarksAndItems(t *testing.T) {
	f := newFixture(t)
	run, q1, q2 := f.readable(t)

	copies := []survey.CopyReading{
		{CopyNumber: 1, Pages: []int{1}, Marks: []survey.Mark{
			{QuestionID: q1.ID, AlternativeID: q1.Alternatives[0].ID},
			{QuestionID: q2.ID, AlternativeID: q2.Alternatives[1].ID},
		}},
		{CopyNumber: 2, Pages: []int{2, 3}, Marks: []survey.Mark{
			{QuestionID: q2.ID, AlternativeID: q2.Alternatives[0].ID},
		}, Items: []survey.ReviewItemDraft{{
			QuestionID: q1.ID, Reason: survey.ReasonAmbiguous,
			Marked: []int64{q1.Alternatives[0].ID, q1.Alternatives[2].ID},
		}}},
	}
	if err := f.store.SaveReadings(f.ctx, run.ID, nil, copies); err != nil {
		t.Fatalf("SaveReadings: %v", err)
	}

	counts, err := f.store.ReadingCounts(f.ctx, run.ID)
	if err != nil {
		t.Fatalf("ReadingCounts: %v", err)
	}
	if counts != (survey.ReadingCounts{Copies: 2, PendingCopies: 1, PendingItems: 1}) || counts.Clean() != 1 {
		t.Errorf("counts = %+v", counts)
	}

	two, err := f.store.CopyByNumber(f.ctx, run.ID, 2)
	if err != nil || !reflect.DeepEqual(two.Pages, []int{2, 3}) {
		t.Fatalf("CopyByNumber(2) = %+v, %v", two, err)
	}
	marks, err := f.store.MarksForCopy(f.ctx, two.ID)
	if err != nil || len(marks) != 1 || marks[0].AlternativeID != q2.Alternatives[0].ID {
		t.Errorf("copy 2's marks = %+v, %v; want only the sure one — an item writes none", marks, err)
	}
	items, err := f.store.ItemsForCopy(f.ctx, two.ID)
	if err != nil || len(items) != 1 {
		t.Fatalf("ItemsForCopy = %+v, %v", items, err)
	}
	if got := items[0]; got.Reason != survey.ReasonAmbiguous || !got.Pending() || got.CopyNumber != 2 ||
		!reflect.DeepEqual(got.Marked, []int64{q1.Alternatives[0].ID, q1.Alternatives[2].ID}) || len(got.Doubtful) != 0 {
		t.Errorf("item = %+v", got)
	}
	pending, err := f.store.PendingCopyNumbers(f.ctx, run.ID)
	if err != nil || !reflect.DeepEqual(pending, []int{2}) {
		t.Errorf("PendingCopyNumbers = %v, %v", pending, err)
	}
	if _, err := f.store.CopyByNumber(f.ctx, run.ID, 9); !errors.Is(err, survey.ErrCopyNotFound) {
		t.Errorf("an unread copy: %v, want ErrCopyNotFound", err)
	}
}

// AMC's report covers the whole project, so every batch brings back the
// copies of the earlier ones. Only a RE-CAPTURED copy is replaced; one the
// batch did not touch keeps what the professor already decided.
func TestALaterBatchReplacesOnlyTheCopiesItRecaptured(t *testing.T) {
	f := newFixture(t)
	run, q1, q2 := f.readable(t)
	item := survey.ReviewItemDraft{QuestionID: q1.ID, Reason: survey.ReasonDoubtful, Doubtful: []int64{q1.Alternatives[1].ID}}
	first := []survey.CopyReading{
		{CopyNumber: 1, Pages: []int{1}, Items: []survey.ReviewItemDraft{item}},
		{CopyNumber: 2, Pages: []int{2}, Items: []survey.ReviewItemDraft{item}},
	}
	if err := f.store.SaveReadings(f.ctx, run.ID, nil, first); err != nil {
		t.Fatalf("first batch: %v", err)
	}
	// The professor decides copy 1's item (S5 does this through the store;
	// here the row is stamped directly).
	f.exec(t, `UPDATE survey_review_item SET resolution = 'discarded', resolved_at = 1
                WHERE copy_id = (SELECT id FROM survey_copy WHERE run_id = ? AND copy_number = 1)`, run.ID)

	sure := survey.Mark{QuestionID: q2.ID, AlternativeID: q2.Alternatives[0].ID}
	second := []survey.CopyReading{
		{CopyNumber: 1, Pages: []int{1}, Items: []survey.ReviewItemDraft{item}}, // the same, untouched
		{CopyNumber: 2, Pages: []int{4}, Marks: []survey.Mark{sure}},            // re-scanned, now clean
		{CopyNumber: 3, Pages: []int{5}, Marks: []survey.Mark{sure}},            // new
	}
	if err := f.store.SaveReadings(f.ctx, run.ID, []int{2}, second); err != nil {
		t.Fatalf("second batch: %v", err)
	}

	one, _ := f.store.CopyByNumber(f.ctx, run.ID, 1)
	if items, _ := f.store.ItemsForCopy(f.ctx, one.ID); len(items) != 1 || items[0].Pending() {
		t.Errorf("copy 1's decided item came back as %+v; a copy the batch did not re-capture keeps it", items)
	}
	two, _ := f.store.CopyByNumber(f.ctx, run.ID, 2)
	if items, _ := f.store.ItemsForCopy(f.ctx, two.ID); len(items) != 0 || !reflect.DeepEqual(two.Pages, []int{4}) {
		t.Errorf("copy 2 was not replaced: pages %v, items %+v", two.Pages, items)
	}
	if marks, _ := f.store.MarksForCopy(f.ctx, two.ID); len(marks) != 1 {
		t.Errorf("copy 2's new reading has %d marks, want 1", len(marks))
	}
	counts, _ := f.store.ReadingCounts(f.ctx, run.ID)
	if counts != (survey.ReadingCounts{Copies: 3}) {
		t.Errorf("counts = %+v, want three clean copies", counts)
	}
}
