// Package survey is the anonymous, ungraded paper survey (epic #308,
// ADR-0078): a bank of questions that belongs to one course and is printed,
// applied and read back by the same AMC worker the controls use — with no
// correct answer and no identity anywhere in it.
//
// It is a SIBLING of internal/domain/controls, not an extension of it, and
// it must stay that way: internal/architecture_test.go fails the build if
// this package reaches controls, even transitively. The two share the worker
// and the paper, never a type. That boundary is what keeps a later
// extraction into its own app a mechanical cut (ADR-0078 §Decision 1).
//
// It declares one port, Store, satisfied by
// internal/infra/storage/surveystore — the health.Prober shape
// (backend-code-style.md §The dependency rule).
package survey

import (
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// QuestionKind is how a question is answered. The closed set the schema's
// CHECK admits.
type QuestionKind string

const (
	// KindSingle is one answer among N alternatives. Nominal: its
	// alternatives are names, so it is counted and never averaged.
	KindSingle QuestionKind = "single"
	// KindScale is an ORDERED scale of MinScalePoints to MaxScalePoints
	// points; point k is worth k. The only kind results average (ADR-0078
	// §Decision 3 — it replaced the issue's "Likert 1-5").
	KindScale QuestionKind = "scale"
	// KindMulti is any number of alternatives. Its optional MinMarks /
	// MaxMarks are printed as guidance and enforced by nothing — paper
	// cannot refuse a fourth mark.
	KindMulti QuestionKind = "multi"
)

// Kinds is every QuestionKind, in the order the form offers them.
var Kinds = []QuestionKind{KindSingle, KindScale, KindMulti}

// Limits. Generous for a printed sheet; their job is to keep a pasted essay
// from becoming a ten-page survey, not to shape the prose.
const (
	MaxNameLength        = 200
	MaxDescriptionLength = 2000
	MaxStatementLength   = 1000
	MaxSectionLength     = 120
	MaxLabelLength       = 200

	// MinAlternatives and MaxAlternatives bound single and multi questions.
	// Ten is the number of inputs the form offers.
	MinAlternatives = 2
	MaxAlternatives = 10

	// MinScalePoints and MaxScalePoints bound a scale.
	MinScalePoints = 3
	MaxScalePoints = 7
)

// Sentinel errors callers branch on.
var (
	// ErrSurveyNotFound is a survey id nothing answers to.
	ErrSurveyNotFound = errors.New("survey: no such survey")
	// ErrQuestionNotFound is a question id that is not in the survey named
	// beside it — including one that exists in ANOTHER survey, which must
	// read as absent rather than be edited through the wrong URL.
	ErrQuestionNotFound = errors.New("survey: no such question in that survey")
	// ErrCourseNotFound is a course id nothing answers to, surfaced when a
	// survey is created under it.
	ErrCourseNotFound = errors.New("survey: no such course")

	// ErrInvalid wraps every validation refusal; a caller reads the
	// per-field sentinels below through errors.As on *ValidationError.
	ErrInvalid = errors.New("survey: invalid draft")

	ErrRequired             = errors.New("required")
	ErrTooLong              = errors.New("too long")
	ErrUnknownKind          = errors.New("unknown question kind")
	ErrTooFewAlternatives   = errors.New("too few alternatives")
	ErrTooManyAlternatives  = errors.New("too many alternatives")
	ErrDuplicateAlternative = errors.New("two alternatives carry the same label")
	ErrScalePoints          = errors.New("a scale has 3 to 7 points")
	ErrContextKind          = errors.New("only a single-choice question can be a context question")
	ErrMarksNotAllowed      = errors.New("minimum and maximum marks apply to multi-select only")
	ErrMarksRange           = errors.New("minimum and maximum marks out of range")
)

// Field names a ValidationError keys its problems by. They are also the form
// field names the handler renders, so one string travels from the domain to
// the input that broke.
const (
	FieldName         = "name"
	FieldDescription  = "description"
	FieldKind         = "kind"
	FieldStatement    = "statement"
	FieldSection      = "section"
	FieldAlternatives = "alternatives"
	FieldContext      = "is_context"
	FieldMarks        = "marks"
)

// ValidationError is every problem one draft has, keyed by field, so a
// two-problem submission reads as two messages rather than as "something
// went wrong" (backend-code-style.md §Form / validation / errors). It
// unwraps to ErrInvalid; a caller reads Problems through errors.As.
type ValidationError struct {
	Problems map[string]error
}

func (e *ValidationError) Error() string {
	fields := make([]string, 0, len(e.Problems))
	for field := range e.Problems {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		parts = append(parts, field+": "+e.Problems[field].Error())
	}
	return "survey: invalid draft (" + strings.Join(parts, "; ") + ")"
}

// Unwrap lets errors.Is(err, ErrInvalid) match.
func (e *ValidationError) Unwrap() error { return ErrInvalid }

// Survey is one survey, as stored. It never carries its questions: the bank
// is read separately, so a list page does not load every bank to print a
// count.
type Survey struct {
	ID          int64
	CourseID    int64
	Name        string
	Description string
	CreatedBy   int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
	// ArchivedAt is nil for an active survey.
	ArchivedAt *time.Time
}

// Archived reports whether the survey has been archived.
func (s Survey) Archived() bool { return s.ArchivedAt != nil }

// Question is one question of a bank, with its alternatives in printed
// order.
type Question struct {
	ID       int64
	SurveyID int64
	// Position is 1-based and dense within the survey.
	Position  int
	Kind      QuestionKind
	Statement string
	// Section is a free-text label; "" means none. Consecutive questions
	// that share it are shown, and printed, under one heading (ADR-0078
	// §Decision 4).
	Section   string
	IsContext bool
	// MinMarks and MaxMarks are nil when unset; set only on KindMulti.
	MinMarks     *int
	MaxMarks     *int
	Alternatives []Alternative
}

// Alternative is one answer a question offers. For a scale, Position is the
// point's value.
type Alternative struct {
	ID       int64
	Position int
	Label    string
}

// SurveyDraft is what a professor types to create or edit a survey.
type SurveyDraft struct {
	Name        string
	Description string
}

// Normalize trims the draft and validates it.
func (d SurveyDraft) Normalize() (SurveyDraft, error) {
	out := SurveyDraft{
		Name:        strings.TrimSpace(d.Name),
		Description: strings.TrimSpace(d.Description),
	}
	problems := map[string]error{}
	switch {
	case out.Name == "":
		problems[FieldName] = ErrRequired
	case utf8.RuneCountInString(out.Name) > MaxNameLength:
		problems[FieldName] = ErrTooLong
	}
	if utf8.RuneCountInString(out.Description) > MaxDescriptionLength {
		problems[FieldDescription] = ErrTooLong
	}
	if len(problems) > 0 {
		return out, &ValidationError{Problems: problems}
	}
	return out, nil
}

// QuestionDraft is what a professor types to create or edit a question.
//
// Labels means two different things by kind, and Normalize is where the
// difference lives: for single and multi it is the form's fixed set of
// inputs, whose blank entries are unused rows and are dropped; for a scale
// it is positional — label k names point k, and an empty one is a point
// printed with no words.
type QuestionDraft struct {
	Kind      QuestionKind
	Statement string
	Section   string
	IsContext bool
	Labels    []string
	MinMarks  *int
	MaxMarks  *int
}

// Normalize trims the draft, drops the blank rows of a single or multi
// question, and validates every field, reporting every problem in one
// error.
func (d QuestionDraft) Normalize() (QuestionDraft, error) {
	out := QuestionDraft{
		Kind:      d.Kind,
		Statement: strings.TrimSpace(d.Statement),
		Section:   strings.TrimSpace(d.Section),
		IsContext: d.IsContext,
		MinMarks:  d.MinMarks,
		MaxMarks:  d.MaxMarks,
	}
	problems := map[string]error{}

	switch {
	case out.Statement == "":
		problems[FieldStatement] = ErrRequired
	case utf8.RuneCountInString(out.Statement) > MaxStatementLength:
		problems[FieldStatement] = ErrTooLong
	}
	if utf8.RuneCountInString(out.Section) > MaxSectionLength {
		problems[FieldSection] = ErrTooLong
	}

	switch out.Kind {
	case KindSingle, KindMulti:
		for _, label := range d.Labels {
			if label = strings.TrimSpace(label); label != "" {
				out.Labels = append(out.Labels, label)
			}
		}
		if err := checkChoiceLabels(out.Labels); err != nil {
			problems[FieldAlternatives] = err
		}
	case KindScale:
		out.Labels = make([]string, len(d.Labels))
		for i, label := range d.Labels {
			out.Labels[i] = strings.TrimSpace(label)
		}
		if n := len(out.Labels); n < MinScalePoints || n > MaxScalePoints {
			problems[FieldAlternatives] = ErrScalePoints
		} else if err := checkLabelLengths(out.Labels); err != nil {
			problems[FieldAlternatives] = err
		}
	default:
		problems[FieldKind] = ErrUnknownKind
	}

	if out.IsContext && out.Kind != KindSingle {
		problems[FieldContext] = ErrContextKind
	}

	if out.Kind == KindMulti {
		if err := checkMarks(out.MinMarks, out.MaxMarks, len(out.Labels)); err != nil {
			problems[FieldMarks] = err
		}
	} else if out.MinMarks != nil || out.MaxMarks != nil {
		problems[FieldMarks] = ErrMarksNotAllowed
	}

	if len(problems) > 0 {
		return out, &ValidationError{Problems: problems}
	}
	return out, nil
}

func checkChoiceLabels(labels []string) error {
	switch {
	case len(labels) < MinAlternatives:
		return ErrTooFewAlternatives
	case len(labels) > MaxAlternatives:
		return ErrTooManyAlternatives
	}
	if err := checkLabelLengths(labels); err != nil {
		return err
	}
	// Two equal labels would print two bubbles nobody can tell apart and
	// count as two different answers in every result.
	seen := make(map[string]bool, len(labels))
	for _, label := range labels {
		key := strings.ToLower(label)
		if seen[key] {
			return ErrDuplicateAlternative
		}
		seen[key] = true
	}
	return nil
}

func checkLabelLengths(labels []string) error {
	for _, label := range labels {
		if utf8.RuneCountInString(label) > MaxLabelLength {
			return ErrTooLong
		}
	}
	return nil
}

func checkMarks(minMarks, maxMarks *int, alternatives int) error {
	if minMarks != nil && (*minMarks < 0 || *minMarks > alternatives) {
		return ErrMarksRange
	}
	if maxMarks != nil && (*maxMarks < 1 || *maxMarks > alternatives) {
		return ErrMarksRange
	}
	if minMarks != nil && maxMarks != nil && *minMarks > *maxMarks {
		return ErrMarksRange
	}
	return nil
}

// DefaultScaleLabels is what a new scale of the given number of points
// starts with: the usual agreement wording for five, blank labels (the
// numbers alone) otherwise. A fresh slice every call — the caller edits it.
func DefaultScaleLabels(points int) []string {
	if points == 5 {
		return []string{"Muy en desacuerdo", "En desacuerdo", "Neutral", "De acuerdo", "Muy de acuerdo"}
	}
	if points < 0 {
		points = 0
	}
	return make([]string, points)
}

// Valid reports whether k is one of Kinds.
func (k QuestionKind) Valid() bool {
	for _, known := range Kinds {
		if k == known {
			return true
		}
	}
	return false
}
