package survey

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// RunState is a run's own life (issue #310): open from creation, closed
// when the professor freezes it (#311), cancelled before anything was
// scanned. PDF generation and scan reading are JOB states, not these
// (ADR-0079); "reviewing" is derived from the review queue.
type RunState string

const (
	RunOpen      RunState = "open"
	RunClosed    RunState = "closed"
	RunCancelled RunState = "cancelled"
)

// Run bounds.
const (
	MaxRunNameLength = 120
	MinCopies        = 1
	MaxCopies        = 200
)

// Run sentinels.
var (
	// ErrRunNotFound is a run id that is not a run of the survey named
	// beside it.
	ErrRunNotFound = errors.New("survey: no such run of that survey")
	// ErrBankLocked refuses an edit, a deletion or a move of an existing
	// question once the survey has a run that is not cancelled: an earlier
	// run's answers point at those questions, and comparing runs only
	// means something over the same wording (epic #308). Appending a new
	// question stays allowed.
	ErrBankLocked = errors.New("survey: the bank is locked by a run")
	// ErrEmptyBank refuses a run of a survey with no questions — a sheet
	// with nothing on it.
	ErrEmptyBank = errors.New("survey: a run needs at least one question")
	// ErrRunNotCancellable refuses cancelling a run that is not open, or
	// that has scans or a job in flight.
	ErrRunNotCancellable = errors.New("survey: the run cannot be cancelled")
)

// Field names a run's ValidationError keys its problems by.
const (
	FieldRunName   = "name"
	FieldAppliedOn = "applied_on"
	FieldCopies    = "copies"
)

// Run is one application of a survey.
type Run struct {
	ID       int64
	SurveyID int64
	// Number is per survey, 1-based: "Pasada #3".
	Number int
	Name   string
	// AppliedOn is the day the sheets are applied, YYYY-MM-DD.
	AppliedOn string
	Copies    int
	State     RunState
	CreatedBy int64
	CreatedAt time.Time
	UpdatedAt time.Time
	ClosedAt  *time.Time
}

// LocksBank reports whether this run locks its survey's existing questions.
func (r Run) LocksBank() bool { return r.State != RunCancelled }

// RunQuestion is one entry of a run's snapshot: a question it printed, and
// the number it printed it as.
type RunQuestion struct {
	QuestionID    int64
	PrintedNumber int
}

// RunDraft is what a professor types to create a run or edit one.
type RunDraft struct {
	Name      string
	AppliedOn string
	Copies    int
}

// Normalize trims the draft and validates it. checkCopies is false on an
// edit, where the copies are already printed and are not the professor's
// to change.
func (d RunDraft) Normalize(checkCopies bool) (RunDraft, error) {
	out := RunDraft{
		Name:      strings.TrimSpace(d.Name),
		AppliedOn: strings.TrimSpace(d.AppliedOn),
		Copies:    d.Copies,
	}
	problems := map[string]error{}
	if utf8.RuneCountInString(out.Name) > MaxRunNameLength {
		problems[FieldRunName] = ErrTooLong
	}
	switch {
	case out.AppliedOn == "":
		problems[FieldAppliedOn] = ErrRequired
	default:
		if _, err := time.Parse(time.DateOnly, out.AppliedOn); err != nil {
			problems[FieldAppliedOn] = ErrBadDate
		}
	}
	if checkCopies && (out.Copies < MinCopies || out.Copies > MaxCopies) {
		problems[FieldCopies] = ErrCopiesRange
	}
	if len(problems) > 0 {
		return out, &ValidationError{Problems: problems}
	}
	return out, nil
}

// More run-field sentinels, read through ValidationError.
var (
	ErrBadDate     = errors.New("not a YYYY-MM-DD date")
	ErrCopiesRange = errors.New("copies out of range")
)

// PrintOrder is the order a run prints a bank in: context questions first,
// in bank order, then every other question in bank order (epic #308 — a
// context question is what the results filter by, and answering it first
// is what makes the rest of the sheet read as "about you"). The numbers
// are the ones printed on the sheet, 1-based.
func PrintOrder(questions []Question) []RunQuestion {
	out := make([]RunQuestion, 0, len(questions))
	for _, context := range []bool{true, false} {
		for _, q := range questions {
			if q.IsContext == context {
				out = append(out, RunQuestion{QuestionID: q.ID, PrintedNumber: len(out) + 1})
			}
		}
	}
	return out
}
