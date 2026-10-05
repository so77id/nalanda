package survey

import (
	"errors"
	"time"
)

// What the worker read off a run's sheets (issue #311), stored without
// identity: a copy is a printed sheet's number, never a person.

// Copy is one sheet AMC captured.
type Copy struct {
	ID         int64
	RunID      int64
	CopyNumber int
	// Pages are the physical pages it was captured from, 1-based.
	Pages []int
}

// Mark is one alternative recorded on a copy.
type Mark struct {
	QuestionID    int64
	AlternativeID int64
}

// ReviewReason is why the reader could not decide an answer by itself.
type ReviewReason string

const (
	// ReasonAmbiguous is more than one mark on a question that admits one
	// (single or scale).
	ReasonAmbiguous ReviewReason = "ambiguous"
	// ReasonDoubtful is a mark in the unsure darkness band, with or
	// without a confident one beside it.
	ReasonDoubtful ReviewReason = "doubtful"
)

// Resolution is what the professor decided about a review item.
type Resolution string

const (
	// ResolutionPending is the zero value: nobody decided yet.
	ResolutionPending Resolution = ""
	// ResolutionChosen records the alternatives the professor picked.
	ResolutionChosen Resolution = "chosen"
	// ResolutionDiscarded records nothing: the answer counts as blank.
	ResolutionDiscarded Resolution = "discarded"
)

// ReviewItemDraft is an item as the reading produces it: what was seen,
// as alternative ids of the question.
type ReviewItemDraft struct {
	QuestionID int64
	Reason     ReviewReason
	Marked     []int64
	Doubtful   []int64
}

// ReviewItem is a stored item.
type ReviewItem struct {
	ID         int64
	CopyID     int64
	CopyNumber int
	QuestionID int64
	Reason     ReviewReason
	Marked     []int64
	Doubtful   []int64
	Resolution Resolution
	Comment    string
	ResolvedAt *time.Time
	ResolvedBy *int64
}

// Pending reports whether nobody has decided the item yet.
func (i ReviewItem) Pending() bool { return i.Resolution == ResolutionPending }

// CopyReading is one copy as a batch read it, ready to store: the marks
// the reader was sure of, and the items it was not.
type CopyReading struct {
	CopyNumber int
	Pages      []int
	Marks      []Mark
	Items      []ReviewItemDraft
}

// ReadingCounts is a run's reading at a glance — one aggregate query.
type ReadingCounts struct {
	// Copies is how many sheets were read.
	Copies int
	// PendingCopies is how many of them still have an item to review.
	PendingCopies int
	// PendingItems is how many items wait, across those copies.
	PendingItems int
}

// Clean is how many copies need nothing from the professor.
func (c ReadingCounts) Clean() int { return c.Copies - c.PendingCopies }

// Reading sentinels.
var (
	// ErrCopyNotFound is a copy number the run has not read.
	ErrCopyNotFound = errors.New("survey: no such copy in that run")
	// ErrItemNotFound is a review item that is not one of the run's.
	ErrItemNotFound = errors.New("survey: no such review item in that run")
	// ErrItemResolved refuses deciding an item twice.
	ErrItemResolved = errors.New("survey: the review item is already resolved")
)
