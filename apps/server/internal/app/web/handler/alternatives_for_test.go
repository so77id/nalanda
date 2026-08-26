package handler

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// The review page renders alternatives in the order the student saw them
// on THIS copy (issue #229). alternativesFor uses Answer.Alternatives —
// the authoring-index list in printed order — to line up the bank's
// labels with the paper. When the list is empty (an answer stored before
// #229), it falls back to bank order — the pre-change behaviour.

func TestAlternativesForRendersLabelsInPrintedOrder(t *testing.T) {
	q := bank.Question{
		ID: "tipo-primitivo",
		Alternatives: []string{
			"int",     // authoring index 1
			"String",  // authoring index 2
			"Integer", // authoring index 3
			"Object",  // authoring index 4
		},
	}
	a := controls.Answer{
		QuestionRef:  "tipo-primitivo",
		QuestionType: controls.QuestionSimple,
		Max:          4,
		Alternatives: []int{3, 1, 4, 2},
	}

	got := alternativesFor(a, q, true)

	want := []view.ReviewAlternative{
		{Index: 3, Label: "Integer"},
		{Index: 1, Label: "int"},
		{Index: 4, Label: "Object"},
		{Index: 2, Label: "String"},
	}
	if !equalAlternatives(got, want) {
		t.Errorf("alternativesFor mismatch\ngot  %+v\nwant %+v", got, want)
	}
}

func TestAlternativesForFallsBackToBankOrderWhenLegacy(t *testing.T) {
	q := bank.Question{
		ID: "tipo-primitivo",
		Alternatives: []string{
			"int",     // 1
			"String",  // 2
			"Integer", // 3
			"Object",  // 4
		},
	}
	// No Alternatives — a reading written before #229's storage change.
	a := controls.Answer{
		QuestionRef:  "tipo-primitivo",
		QuestionType: controls.QuestionSimple,
		Max:          4,
	}

	got := alternativesFor(a, q, true)

	// Bank order, 1..N — indistinguishable from the pre-change behaviour.
	want := []view.ReviewAlternative{
		{Index: 1, Label: "int"},
		{Index: 2, Label: "String"},
		{Index: 3, Label: "Integer"},
		{Index: 4, Label: "Object"},
	}
	if !equalAlternatives(got, want) {
		t.Errorf("alternativesFor mismatch\ngot  %+v\nwant %+v", got, want)
	}
}

// TestAlternativesForFallsBackToBankOrderWithoutBankLabels covers the
// path where the bank does not resolve — a professor wiped a question
// but a reading still references it. Pre-#229 the labels went generic
// (`Opción 1..N`) in bank order; the layout order must not break that.
func TestAlternativesForRendersGenericLabelsInPrintedOrderWithoutBank(t *testing.T) {
	a := controls.Answer{
		QuestionRef:  "gone-from-bank",
		QuestionType: controls.QuestionSimple,
		Max:          4,
		Alternatives: []int{2, 4, 1, 3},
	}

	got := alternativesFor(a, bank.Question{}, false)

	// Labels are the fallback `Opción N`; N is the AUTHORING index (the
	// number the store persisted as `marked`), not the printed slot —
	// otherwise the professor's tick on "Opción 2" would send a different
	// integer to save_review.
	want := []view.ReviewAlternative{
		{Index: 2, Label: "Opción 2"},
		{Index: 4, Label: "Opción 4"},
		{Index: 1, Label: "Opción 1"},
		{Index: 3, Label: "Opción 3"},
	}
	if !equalAlternatives(got, want) {
		t.Errorf("alternativesFor mismatch\ngot  %+v\nwant %+v", got, want)
	}
}

// TestAlternativesForFallsBackWhenAlternativesLengthMismatchesMax covers a
// malformed analyzer emit: a wrong-length Alternatives (short, over-long,
// or a lone bad index) triggers the bank-order fallback, so a "[99]" from
// a buggy analyzer no longer renders one option instead of four (review
// COR-1). Nothing panics; index bounds stay inside labels.
func TestAlternativesForFallsBackWhenAlternativesLengthMismatchesMax(t *testing.T) {
	q := bank.Question{
		ID:           "tipo-primitivo",
		Alternatives: []string{"int", "String", "Integer", "Object"},
	}
	for _, tc := range []struct {
		name string
		alts []int
	}{
		{"single bad index", []int{99}},
		{"short list", []int{1, 2}},
		{"over-long list", []int{1, 2, 3, 4, 5}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := controls.Answer{
				QuestionRef:  "tipo-primitivo",
				QuestionType: controls.QuestionSimple,
				Max:          4,
				Alternatives: tc.alts,
			}
			got := alternativesFor(a, q, true)
			want := []view.ReviewAlternative{
				{Index: 1, Label: "int"},
				{Index: 2, Label: "String"},
				{Index: 3, Label: "Integer"},
				{Index: 4, Label: "Object"},
			}
			if !equalAlternatives(got, want) {
				t.Errorf("alternativesFor mismatch\ngot  %+v\nwant %+v", got, want)
			}
		})
	}
}

func equalAlternatives(a, b []view.ReviewAlternative) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
