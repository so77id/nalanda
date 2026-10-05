package survey

import (
	"context"
	"time"
)

// Store is the persistence this domain needs.
//
// Declared here because this is where it is consumed; implemented by
// internal/infra/storage/surveystore. Every method that changes a bank
// stamps the survey's updated_at with the time it is handed, so "last
// edited" is one column and not a scan of its questions.
type Store interface {
	// CreateSurvey inserts the row and returns it with its id. A course
	// nothing answers to is ErrCourseNotFound.
	CreateSurvey(ctx context.Context, s Survey) (Survey, error)

	// SurveyByID returns one survey, archived or not, or ErrSurveyNotFound.
	SurveyByID(ctx context.Context, id int64) (Survey, error)

	// SurveysForCourse returns every survey of one course, archived ones
	// included, most recently created first. Splitting active from archived
	// is the service's job, so the rule lives in one place.
	SurveysForCourse(ctx context.Context, courseID int64) ([]Survey, error)

	// QuestionCounts returns, per survey id of one course, how many
	// questions its bank holds. A survey with an empty bank has no entry.
	// One aggregate for the list page, never one query per row
	// (apps/server/CLAUDE.md).
	QuestionCounts(ctx context.Context, courseID int64) (map[int64]int, error)

	// UpdateSurvey rewrites name and description. ErrSurveyNotFound when
	// there is no such survey.
	UpdateSurvey(ctx context.Context, id int64, d SurveyDraft, now time.Time) error

	// SetArchived stamps archived_at (at != nil) or clears it (at == nil).
	// Idempotent; ErrSurveyNotFound when there is no such survey.
	SetArchived(ctx context.Context, id int64, at *time.Time, now time.Time) error

	// Questions returns the bank, in position order, each question with its
	// alternatives in position order. ErrSurveyNotFound when there is no
	// such survey — an empty bank is an empty slice, not an error.
	Questions(ctx context.Context, surveyID int64) ([]Question, error)

	// AddQuestion appends a NORMALIZED draft at the end of the bank.
	AddQuestion(ctx context.Context, surveyID int64, d QuestionDraft, now time.Time) (Question, error)

	// UpdateQuestion replaces a question's fields and its alternatives with
	// a NORMALIZED draft, keeping its position. ErrQuestionNotFound when the
	// question is not in this survey; ErrBankLocked when a run that is not
	// cancelled exists (checked inside the write's own transaction, so a
	// run created concurrently cannot slip between check and write — the
	// same holds for DeleteQuestion and MoveQuestion).
	UpdateQuestion(ctx context.Context, surveyID, questionID int64, d QuestionDraft, now time.Time) error

	// DeleteQuestion removes a question (its alternatives cascade) and closes
	// the gap, so positions stay dense. ErrQuestionNotFound as above.
	DeleteQuestion(ctx context.Context, surveyID, questionID int64, now time.Time) error

	// MoveQuestion swaps a question with its neighbour above (delta -1) or
	// below (+1). Moving the first up or the last down changes nothing and
	// is not an error. ErrQuestionNotFound as above.
	MoveQuestion(ctx context.Context, surveyID, questionID int64, delta int, now time.Time) error

	// CreateRun inserts a run with the next number for its survey and its
	// printed snapshot, in one transaction. ErrSurveyNotFound when there is
	// no such survey.
	CreateRun(ctx context.Context, r Run, printed []RunQuestion) (Run, error)

	// Run returns one run of the survey, or ErrRunNotFound — including a
	// run of ANOTHER survey reached through this one's URL.
	Run(ctx context.Context, surveyID, runID int64) (Run, error)

	// RunsForSurvey returns the survey's runs, most recent number first.
	RunsForSurvey(ctx context.Context, surveyID int64) ([]Run, error)

	// RunQuestions returns a run's snapshot in printed order.
	RunQuestions(ctx context.Context, runID int64) ([]RunQuestion, error)

	// UpdateRun rewrites a run's name and date. ErrRunNotFound as above.
	UpdateRun(ctx context.Context, surveyID, runID int64, d RunDraft, now time.Time) error

	// CancelRun moves an OPEN run to cancelled. ErrRunNotCancellable when
	// it is not open; ErrRunNotFound as above.
	CancelRun(ctx context.Context, surveyID, runID int64, now time.Time) error

	// RunSummaries returns, per survey id of one course, how many runs it
	// has that are not cancelled and the latest date among them. A survey
	// with none has no entry. One aggregate for the list page.
	RunSummaries(ctx context.Context, courseID int64) (map[int64]RunSummary, error)
}

// RunSummary is one survey's runs, as a list page shows them.
type RunSummary struct {
	Runs          int
	LastAppliedOn string
}
