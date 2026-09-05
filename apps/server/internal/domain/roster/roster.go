// Package roster is the course and the people on it: the `course`,
// `student` and `enrollment` rows migration 00014 creates, and the policy
// that fills them from Canvas.
//
// Named for what it contains rather than `course`, which already exists as
// the namespace holding the question bank (`internal/domain/course/bank`)
// and which would make every type here stutter — `course.Course`. The issue
// that opened this WP proposed the other name; this one costs nothing and
// reads better at every call site.
//
// It declares two ports and implements neither: Store, satisfied by
// internal/infra/storage/coursestore, and CourseSource, satisfied by
// internal/domain/canvas's Service. Both point inwards, the health.Prober
// shape (backend-code-style.md §The dependency rule).
package roster

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors callers branch on.
var (
	// ErrCourseNotFound is a Nalanda course id nothing answers to.
	ErrCourseNotFound = errors.New("roster: no such course")

	// ErrAlreadyAdded is the picker being asked for a Canvas course this
	// server already has. A refusal rather than a second row: the schema's
	// UNIQUE on canvas_course_id says the same thing, and this is what lets
	// the handler render "ya lo agregaste" instead of a 500.
	ErrAlreadyAdded = errors.New("roster: that Canvas course is already added")

	// ErrNotInCanvas is a Canvas course id the professor's own Canvas does
	// not list. Reached by a hand-typed POST, or by a course that
	// disappeared between the page render and the click.
	ErrNotInCanvas = errors.New("roster: Canvas does not list that course for this professor")

	// ErrDuplicateRUT is two DIFFERENT Canvas users carrying the same RUT.
	// The import refuses rather than picking one: `student.rut` is the key
	// WP-2 matches grades on, and a silent choice between two people is a
	// grade delivered to the wrong one. Not observed in the S4 spike (25
	// distinct RUTs on 25 students) — which is why it is an error and not
	// a policy.
	ErrDuplicateRUT = errors.New("roster: two Canvas users carry the same RUT")
)

// Enrollment states. The two the schema's CHECK admits.
const (
	// StateEnrolled is a student Canvas currently lists on the course.
	StateEnrolled = "enrolled"
	// StateWithdrawn is a student who WAS on the course and is no longer
	// listed by Canvas. The row is never deleted: their grades hang off
	// the RUT match in WP-2, and deleting the enrolment would orphan a
	// control they actually sat.
	StateWithdrawn = "withdrawn"
)

// Course is one course this server knows about, as stored.
type Course struct {
	ID             int64
	Name           string
	Code           string
	Term           string
	CanvasCourseID string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Store is the persistence this domain needs.
//
// Declared here because this is where it is consumed; implemented by
// internal/infra/storage/coursestore.
type Store interface {
	// CreateCourse inserts the row and returns it with its id. A Canvas
	// course that is already stored comes back as ErrAlreadyAdded rather
	// than as the driver's UNIQUE-violation text — absence and collision
	// are this domain's vocabulary, not SQLite's.
	CreateCourse(ctx context.Context, c Course) (Course, error)

	// ListCourses returns every course, most recently created first.
	ListCourses(ctx context.Context) ([]Course, error)

	// CourseByID returns one course, or ErrCourseNotFound.
	CourseByID(ctx context.Context, id int64) (Course, error)

	// SaveRoster applies one import to one course, ATOMICALLY: every
	// student is upserted, every enrolment is upserted as enrolled, and
	// every enrolment Canvas no longer lists is stamped withdrawn — all of
	// it, or none of it.
	//
	// Atomic because a half-applied roster is worse than no roster: it
	// looks like a class where some students vanished, and the professor
	// has no way to tell which half arrived. The result counts what it
	// did, for the flash.
	SaveRoster(ctx context.Context, courseID int64, students []SourceStudent) (ImportResult, error)

	// ListEnrollments returns the course's people, enrolled first.
	ListEnrollments(ctx context.Context, courseID int64) ([]Enrollment, error)
}

// Student is one person, as stored. The RUT is split into the eight-digit
// body the printed sheet reads and the verifier Canvas attaches — ADR-0069
// §Decision 1 has the whole reasoning. Both are empty together when Canvas
// held no readable RUT.
type Student struct {
	ID           int64
	FirstName    string
	LastName     string
	Email        string
	RUT          string
	RUTDV        string
	CanvasUserID string
}

// HasRUT reports whether this student can be matched to a reading at all.
func (s Student) HasRUT() bool { return s.RUT != "" }

// Enrollment is one person's membership of one course.
type Enrollment struct {
	ID                 int64
	CourseID           int64
	Student            Student
	State              string
	CanvasEnrollmentID string
}

// ImportResult is what one roster import did, for the flash the professor
// reads afterwards.
type ImportResult struct {
	// Added is students who had no enrolment on this course before.
	Added int
	// Updated is students already enrolled whose row was refreshed.
	Updated int
	// Withdrawn is enrolments Canvas no longer lists, stamped withdrawn
	// rather than deleted.
	Withdrawn int
	// WithoutRUT is students imported with no RUT, and therefore
	// unmatchable by WP-2. Surfaced because it is the one outcome that
	// looks like success and is not.
	WithoutRUT int
}

// Total is how many students Canvas listed.
func (r ImportResult) Total() int { return r.Added + r.Updated }

// CourseSource is the Canvas end: "which courses does this professor have,
// according to Canvas".
//
// An interface rather than a direct call to the canvas package so this
// domain can be tested without a Canvas at all, and so the token handling
// stays where it belongs — the implementation (canvas.Service) is what
// decrypts it.
type CourseSource interface {
	CoursesFor(ctx context.Context, userID int64) ([]SourceCourse, error)

	// RosterFor returns the students of one Canvas course, already
	// normalised — the RUT split, the names taken off sortableName, staff
	// skipped (ADR-0069).
	RosterFor(ctx context.Context, userID int64, canvasCourseID string) ([]SourceStudent, error)
}

// SourceCourse is one course as the source describes it. A shape of this
// domain's own rather than canvas.Course, so a second source — a CSV, a
// different LMS — costs an adapter and not a change here.
type SourceCourse struct {
	CanvasID string
	Name     string
	Code     string
	Term     string
	// TermStart orders the picker. RFC 3339 as Canvas sends it, compared as
	// a string, which is correct for that format.
	TermStart string
}

// SourceStudent is one student as the source describes them, normalised.
type SourceStudent struct {
	FirstName          string
	LastName           string
	Email              string
	RUT                string
	RUTDV              string
	CanvasUserID       string
	CanvasEnrollmentID string
}
