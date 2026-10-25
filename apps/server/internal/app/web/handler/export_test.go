package handler

import "time"

// SetReviewAnnotateDeadline shortens the review save's annotate deadline
// for a test, and returns what restores it.
func SetReviewAnnotateDeadline(d time.Duration) (restore func()) {
	was := reviewAnnotateDeadline
	reviewAnnotateDeadline = d
	return func() { reviewAnnotateDeadline = was }
}
