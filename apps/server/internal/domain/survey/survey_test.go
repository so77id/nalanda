package survey_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

func intp(n int) *int { return &n }

// problemOf returns the sentinel err carries for field, or nil.
func problemOf(err error, field string) error {
	var v *survey.ValidationError
	if !errors.As(err, &v) {
		return nil
	}
	return v.Problems[field]
}

// validSingle is the fixture every QuestionDraft case breaks in exactly one
// way (backend-code-style.md §Testing).
func validSingle() survey.QuestionDraft {
	return survey.QuestionDraft{
		Kind:      survey.KindSingle,
		Statement: "¿En qué sección estás?",
		Section:   "Contexto",
		IsContext: true,
		Labels:    []string{"A", "B", "C"},
	}
}

func TestADraftSurveyNeedsANameAndKeepsItsDescription(t *testing.T) {
	got, err := survey.SurveyDraft{Name: "  Autoevaluación  ", Description: " Es anónima. "}.Normalize()
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if got.Name != "Autoevaluación" || got.Description != "Es anónima." {
		t.Errorf("got %+v, want both fields trimmed", got)
	}

	_, err = survey.SurveyDraft{Name: "   "}.Normalize()
	if !errors.Is(err, survey.ErrInvalid) {
		t.Fatalf("a blank name: err = %v, want ErrInvalid", err)
	}
	if !errors.Is(problemOf(err, survey.FieldName), survey.ErrRequired) {
		t.Errorf("a blank name: problem = %v, want ErrRequired on %q", problemOf(err, survey.FieldName), survey.FieldName)
	}

	_, err = survey.SurveyDraft{Name: strings.Repeat("a", survey.MaxNameLength+1)}.Normalize()
	if !errors.Is(problemOf(err, survey.FieldName), survey.ErrTooLong) {
		t.Errorf("a long name: problem = %v, want ErrTooLong", problemOf(err, survey.FieldName))
	}
}

func TestAValidSingleChoiceQuestionNormalizes(t *testing.T) {
	d := validSingle()
	d.Statement = "  " + d.Statement + "  "
	d.Labels = []string{" A ", "", "B", "   ", "C"}

	got, err := d.Normalize()
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if got.Statement != "¿En qué sección estás?" {
		t.Errorf("statement = %q, want it trimmed", got.Statement)
	}
	// Blank inputs are the unused rows of a fixed-size form, not alternatives.
	if strings.Join(got.Labels, "|") != "A|B|C" {
		t.Errorf("labels = %q, want the blanks dropped and the rest trimmed", got.Labels)
	}
}

func TestQuestionDraftRefusals(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*survey.QuestionDraft)
		field  string
		want   error
	}{
		{"an unknown kind", func(d *survey.QuestionDraft) { d.Kind = "ranking" }, survey.FieldKind, survey.ErrUnknownKind},
		{"a blank statement", func(d *survey.QuestionDraft) { d.Statement = " " }, survey.FieldStatement, survey.ErrRequired},
		{"a long statement", func(d *survey.QuestionDraft) { d.Statement = strings.Repeat("x", survey.MaxStatementLength+1) }, survey.FieldStatement, survey.ErrTooLong},
		{"a long section", func(d *survey.QuestionDraft) { d.Section = strings.Repeat("x", survey.MaxSectionLength+1) }, survey.FieldSection, survey.ErrTooLong},
		{"one alternative", func(d *survey.QuestionDraft) { d.Labels = []string{"A", " "} }, survey.FieldAlternatives, survey.ErrTooFewAlternatives},
		{"eleven alternatives", func(d *survey.QuestionDraft) {
			d.Labels = strings.Split("a b c d e f g h i j k", " ")
		}, survey.FieldAlternatives, survey.ErrTooManyAlternatives},
		{"two equal alternatives", func(d *survey.QuestionDraft) { d.Labels = []string{"A", "B", "A"} }, survey.FieldAlternatives, survey.ErrDuplicateAlternative},
		{"two alternatives equal but for case", func(d *survey.QuestionDraft) { d.Labels = []string{"Sí", "No", "sí"} }, survey.FieldAlternatives, survey.ErrDuplicateAlternative},
		{"a long alternative", func(d *survey.QuestionDraft) { d.Labels = []string{"A", strings.Repeat("x", survey.MaxLabelLength+1)} }, survey.FieldAlternatives, survey.ErrTooLong},
		{"marks on a single-choice question", func(d *survey.QuestionDraft) { d.MinMarks = intp(1) }, survey.FieldMarks, survey.ErrMarksNotAllowed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := validSingle()
			tc.mutate(&d)
			_, err := d.Normalize()
			if !errors.Is(err, survey.ErrInvalid) {
				t.Fatalf("err = %v, want ErrInvalid", err)
			}
			if got := problemOf(err, tc.field); !errors.Is(got, tc.want) {
				t.Errorf("problem on %q = %v, want %v", tc.field, got, tc.want)
			}
		})
	}
}

func TestAScaleHasThreeToSevenPointsWhoseLabelsMayBeEmpty(t *testing.T) {
	for points := survey.MinScalePoints; points <= survey.MaxScalePoints; points++ {
		d := survey.QuestionDraft{Kind: survey.KindScale, Statement: "¿Qué tan clara?", Labels: make([]string, points)}
		got, err := d.Normalize()
		if err != nil {
			t.Fatalf("%d points: %v", points, err)
		}
		// A scale's labels are positional: an empty one is point k printed
		// with no words, never a row to drop.
		if len(got.Labels) != points {
			t.Errorf("%d points: kept %d labels", points, len(got.Labels))
		}
	}
	for _, points := range []int{2, 8} {
		d := survey.QuestionDraft{Kind: survey.KindScale, Statement: "¿Qué tan clara?", Labels: make([]string, points)}
		_, err := d.Normalize()
		if !errors.Is(problemOf(err, survey.FieldAlternatives), survey.ErrScalePoints) {
			t.Errorf("%d points: problem = %v, want ErrScalePoints", points, problemOf(err, survey.FieldAlternatives))
		}
	}
}

func TestOnlyASingleChoiceQuestionCanBeAContextQuestion(t *testing.T) {
	for _, kind := range []survey.QuestionKind{survey.KindScale, survey.KindMulti} {
		d := survey.QuestionDraft{Kind: kind, Statement: "¿?", Labels: []string{"1", "2", "3"}, IsContext: true}
		_, err := d.Normalize()
		if !errors.Is(problemOf(err, survey.FieldContext), survey.ErrContextKind) {
			t.Errorf("%s: problem = %v, want ErrContextKind", kind, problemOf(err, survey.FieldContext))
		}
	}
}

func TestMultiSelectMarksAreOptionalAndBounded(t *testing.T) {
	base := func() survey.QuestionDraft {
		return survey.QuestionDraft{Kind: survey.KindMulti, Statement: "¿Cuáles?", Labels: []string{"A", "B", "C", "D"}}
	}

	ok := []struct {
		name     string
		min, max *int
	}{
		{"neither", nil, nil},
		{"min only", intp(1), nil},
		{"max only", nil, intp(4)},
		{"min equals max", intp(2), intp(2)},
		{"zero min", intp(0), intp(3)},
	}
	for _, tc := range ok {
		d := base()
		d.MinMarks, d.MaxMarks = tc.min, tc.max
		if _, err := d.Normalize(); err != nil {
			t.Errorf("%s: %v", tc.name, err)
		}
	}

	bad := []struct {
		name     string
		min, max *int
	}{
		{"negative min", intp(-1), nil},
		{"zero max", nil, intp(0)},
		{"min above max", intp(3), intp(2)},
		{"max above the alternatives", nil, intp(5)},
		{"min above the alternatives", intp(5), nil},
	}
	for _, tc := range bad {
		d := base()
		d.MinMarks, d.MaxMarks = tc.min, tc.max
		_, err := d.Normalize()
		if !errors.Is(problemOf(err, survey.FieldMarks), survey.ErrMarksRange) {
			t.Errorf("%s: problem = %v, want ErrMarksRange", tc.name, problemOf(err, survey.FieldMarks))
		}
	}
}

func TestDefaultScaleLabelsAreAgreementOnFivePointsAndBlankOtherwise(t *testing.T) {
	five := survey.DefaultScaleLabels(5)
	if len(five) != 5 || five[0] != "Muy en desacuerdo" || five[4] != "Muy de acuerdo" {
		t.Errorf("five points: %q", five)
	}
	four := survey.DefaultScaleLabels(4)
	if len(four) != 4 || strings.Join(four, "") != "" {
		t.Errorf("four points: %q, want four blank labels", four)
	}
	// The slice is the caller's to edit: a shared backing array would let
	// one form's edit leak into the next form's defaults.
	five[0] = "cambiado"
	if survey.DefaultScaleLabels(5)[0] != "Muy en desacuerdo" {
		t.Error("DefaultScaleLabels returned a shared slice")
	}
}

func TestEveryProblemIsReportedInOneRun(t *testing.T) {
	d := survey.QuestionDraft{Kind: survey.KindMulti, Statement: "", Labels: []string{"A"}, IsContext: true}
	_, err := d.Normalize()
	for _, field := range []string{survey.FieldStatement, survey.FieldAlternatives, survey.FieldContext} {
		if problemOf(err, field) == nil {
			t.Errorf("no problem reported on %q: %v", field, err)
		}
	}
}
