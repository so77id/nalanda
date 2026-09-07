// Package matching joins what AMC read off a sheet to a person on a
// roster: `reading.rut_read` to `student.id`, scoped to the course the
// control belongs to.
//
// It is its own package rather than a method on `roster` or on `controls`
// because it is the seam BETWEEN them, and both ends already exist. Put in
// `roster` it would make the roster know about readings; put in `controls`
// it would make the controls domain know how a RUT is spelled. Here,
// `controls` imports it (domain to domain, which the dependency rule
// allows) and the roster stays a roster.
//
// It declares one port and implements none: Store, satisfied by
// internal/infra/storage/coursestore, pointing inwards like health.Prober
// (backend-code-style.md §The dependency rule).
//
// WHAT IT REFUSES TO DO. It never guesses. Every path that cannot produce
// a confident answer returns (nil, nil) — no match, no error — and the
// caller leaves `student_id` NULL so the copy stays in the reconciliation
// queue a human already watches. The one thing worse than an unmatched
// copy is a copy matched to the wrong person, because that is a grade
// delivered to somebody it does not belong to and nothing downstream would
// notice.
package matching

import (
	"context"
	"fmt"
)

// Store is the persistence this domain needs.
//
// Declared here because this is where it is consumed; implemented by
// internal/infra/storage/coursestore, which owns the `student` and
// `enrollment` tables.
type Store interface {
	// EnrolledStudentByRUT returns the id of the student whose `rut` is
	// exactly this eight-digit body AND whose enrolment on this course is
	// `enrolled`.
	//
	// found=false is an ordinary answer, not a failure: the RUT belongs to
	// nobody, or to somebody who withdrew, or to somebody on another
	// course. At most one row can satisfy it — `student.rut` is UNIQUE and
	// `enrollment` is UNIQUE per (course, student).
	//
	// The RUT arrives already normalised. A store comparing a raw
	// "11.222.333-5" against a column that holds "11222333" would find
	// nothing and say so, which is indistinguishable from a real absence.
	EnrolledStudentByRUT(ctx context.Context, rut string, courseID int64) (studentID int64, found bool, err error)
}

// Service is the matching policy.
type Service struct {
	Store Store
}

// NewService returns the service. A nil store is a wiring mistake, and
// wiring time is the one place §Errors allows a panic.
func NewService(store Store) *Service {
	if store == nil {
		panic("matching.NewService: no store")
	}
	return &Service{Store: store}
}

// MatchByRUT resolves a RUT to the student who sat this control, or to
// nobody.
//
// Returns (nil, nil) for every case where the answer is honestly "no
// match": a RUT that cannot be normalised (illegible boxes, a typo), a
// control with no course to scope by, or a RUT that belongs to nobody
// enrolled here. The caller writes NULL and the existing reconciliation
// queue surfaces the copy.
//
// Returns an error ONLY when the question could not be asked — a database
// failure. The distinction is load-bearing: a caller that flattened the
// two would write NULL on an outage and record "this student is not on
// the roster" as a fact about a query that never ran.
//
// The scope is strict. A student enrolled on a DIFFERENT course does not
// match, and neither does one who withdrew from this one, even though
// `student.rut` is globally UNIQUE and the person is therefore
// unambiguously identified (decided 2026-09-06, issue #272 AC2). The
// association is what WP-3 addresses an email by; a copy filed under
// somebody who was never on this course is a grade delivered on the
// strength of a coincidence nobody checked.
func (s *Service) MatchByRUT(ctx context.Context, rut string, courseID int64) (*int64, error) {
	// A control with no course has no roster to match against. Every
	// control that predates migration 00015 is in this state, and it is
	// resolved by a professor on the detail page, not here. Asking the
	// store with course 0 would run a query that matches nobody and read
	// back as "this student is not enrolled" — a different, and false,
	// statement.
	if courseID <= 0 {
		return nil, nil
	}

	normalized, ok := NormalizeRUT(rut)
	if !ok {
		return nil, nil
	}

	studentID, found, err := s.Store.EnrolledStudentByRUT(ctx, normalized, courseID)
	if err != nil {
		return nil, fmt.Errorf("matching.MatchByRUT %s on course %d: %w", normalized, courseID, err)
	}
	if !found {
		return nil, nil
	}
	return &studentID, nil
}
