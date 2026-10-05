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

	// CreateRun inserts a run with the next number for its survey and
	// snapshots the bank it prints (PrintOrder), reading that bank INSIDE
	// the same transaction, after the write lock — so a question edited
	// concurrently can never be printed in one wording and locked in
	// another (#310 review, COR-5). Returns the run and the questions it
	// prints, for the sheet. ErrSurveyNotFound when there is no such
	// survey; ErrEmptyBank when it has no questions.
	CreateRun(ctx context.Context, r Run) (Run, []Question, error)

	// Run returns one run of the survey, or ErrRunNotFound — including a
	// run of ANOTHER survey reached through this one's URL.
	Run(ctx context.Context, surveyID, runID int64) (Run, error)

	// RunsForSurvey returns the survey's runs, most recent number first.
	RunsForSurvey(ctx context.Context, surveyID int64) ([]Run, error)

	// RunQuestions returns a run's snapshot in printed order.
	RunQuestions(ctx context.Context, runID int64) ([]RunQuestion, error)

	// UpdateRun rewrites an OPEN run's name and date. ErrRunNotOpen when it
	// is closed or cancelled; ErrRunNotFound as above.
	UpdateRun(ctx context.Context, surveyID, runID int64, d RunDraft, now time.Time) error

	// CancelRun moves an OPEN run to cancelled and drops its snapshot, so
	// the questions it printed can be deleted again — a cancelled run is
	// excluded from everything and must not hold the bank (#310 review,
	// COR-1). ErrRunNotCancellable when it is not open; ErrRunHasScans
	// when it has read copies (#311; checked in the same statement, so a
	// reading stored concurrently cannot slip under it); ErrRunNotFound as
	// above.
	CancelRun(ctx context.Context, surveyID, runID int64, now time.Time) error

	// RunSummaries returns, per survey id of one course, how many runs it
	// has that are not cancelled and the latest date among them. A survey
	// with none has no entry. One aggregate for the list page.
	RunSummaries(ctx context.Context, courseID int64) (map[int64]RunSummary, error)

	// SaveReadings stores what one batch read, in one transaction (issue
	// #311). AMC's report covers the whole project, so every batch brings
	// back the copies of the earlier ones: a copy in `recaptured` is
	// deleted first (its marks and items cascade) and stored again; a copy
	// that already exists and was NOT re-captured is left exactly as it is
	// — the professor's resolutions included; a new copy is inserted.
	SaveReadings(ctx context.Context, runID int64, recaptured []int, copies []CopyReading) error

	// ReadingCounts is the run's reading at a glance, one aggregate query.
	ReadingCounts(ctx context.Context, runID int64) (ReadingCounts, error)

	// CopyByNumber returns one read copy, or ErrCopyNotFound.
	CopyByNumber(ctx context.Context, runID int64, copyNumber int) (Copy, error)

	// MarksForCopy returns a copy's recorded marks.
	MarksForCopy(ctx context.Context, copyID int64) ([]Mark, error)

	// ItemsForCopy returns a copy's review items, resolved ones included,
	// in question id order.
	ItemsForCopy(ctx context.Context, copyID int64) ([]ReviewItem, error)

	// PendingCopyNumbers returns, in order, the copies of the run that
	// still have an item to review.
	PendingCopyNumbers(ctx context.Context, runID int64) ([]int, error)

	// ResolveItems records decisions on one copy's items in one
	// transaction: the stamp, the comment, and — for a chosen one — its
	// marks. ErrRunNotOpen unless the run is open; ErrItemNotFound for an
	// item that is not the copy's; ErrItemResolved for one already
	// decided. Validating the choice against the question is the
	// service's (ResolveCopy).
	ResolveItems(ctx context.Context, runID, copyID int64, decisions []ItemResolution, by int64, now time.Time) error

	// DeleteReadings removes every copy of an OPEN run — its marks and
	// review items cascade — for "Borrar escaneos". ErrRunNotOpen
	// otherwise.
	DeleteReadings(ctx context.Context, runID int64) error

	// DecidedItems counts the run's review items already resolved.
	DecidedItems(ctx context.Context, runID int64) (int, error)

	// CloseRun freezes an OPEN run that has read copies and nothing left
	// to review, stamping closed_at — in one guarded statement, so a batch
	// stored or an item reopened concurrently cannot slip under it.
	// ErrRunNotOpen, ErrNothingRead or ErrReviewPending otherwise;
	// ErrRunNotFound as above.
	CloseRun(ctx context.Context, surveyID, runID int64, now time.Time) error
}

// RunSummary is one survey's runs, as a list page shows them.
type RunSummary struct {
	Runs          int
	LastAppliedOn string
}
