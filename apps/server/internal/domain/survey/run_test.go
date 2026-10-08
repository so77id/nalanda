package survey_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

func TestARunDraftNeedsADateAndCopiesInRange(t *testing.T) {
	got, err := survey.RunDraft{Name: "  Mitad de semestre ", AppliedOn: " 2026-10-15 ", Copies: 45}.Normalize(true)
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if got.Name != "Mitad de semestre" || got.AppliedOn != "2026-10-15" {
		t.Errorf("got %+v, want trimmed", got)
	}

	cases := []struct {
		name  string
		draft survey.RunDraft
		field string
		want  error
	}{
		{"no date", survey.RunDraft{Copies: 10}, survey.FieldAppliedOn, survey.ErrRequired},
		{"not a date", survey.RunDraft{AppliedOn: "15/10/2026", Copies: 10}, survey.FieldAppliedOn, survey.ErrBadDate},
		{"an impossible date", survey.RunDraft{AppliedOn: "2026-02-30", Copies: 10}, survey.FieldAppliedOn, survey.ErrBadDate},
		{"zero copies", survey.RunDraft{AppliedOn: "2026-10-15", Copies: 0}, survey.FieldCopies, survey.ErrCopiesRange},
		{"too many copies", survey.RunDraft{AppliedOn: "2026-10-15", Copies: survey.MaxCopies + 1}, survey.FieldCopies, survey.ErrCopiesRange},
		{"a long name", survey.RunDraft{Name: strings.Repeat("x", survey.MaxRunNameLength+1), AppliedOn: "2026-10-15", Copies: 1}, survey.FieldRunName, survey.ErrTooLong},
	}
	for _, tc := range cases {
		_, err := tc.draft.Normalize(true)
		if !errors.Is(problemOf(err, tc.field), tc.want) {
			t.Errorf("%s: problem on %q = %v, want %v", tc.name, tc.field, problemOf(err, tc.field), tc.want)
		}
	}

	// On an edit the copies are already printed and are not checked.
	if _, err := (survey.RunDraft{AppliedOn: "2026-10-15"}).Normalize(false); err != nil {
		t.Errorf("an edit with no copies: %v", err)
	}
}

func TestPrintOrderPutsContextQuestionsFirstAndKeepsBankOrder(t *testing.T) {
	q := func(id int64, context bool) survey.Question { return survey.Question{ID: id, IsContext: context} }
	got := survey.PrintOrder([]survey.Question{q(10, false), q(11, true), q(12, false), q(13, true)})

	var order []int64
	for i, rq := range got {
		if rq.PrintedNumber != i+1 {
			t.Errorf("entry %d printed as %d, want %d", i, rq.PrintedNumber, i+1)
		}
		order = append(order, rq.QuestionID)
	}
	want := []int64{11, 13, 10, 12}
	if len(order) != len(want) {
		t.Fatalf("order = %v, want %v", order, want)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("order = %v, want %v", order, want)
		}
	}
}
