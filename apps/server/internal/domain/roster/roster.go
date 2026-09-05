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
}

// CourseSource is the Canvas end: "which courses does this professor have,
// according to Canvas".
//
// An interface rather than a direct call to the canvas package so this
// domain can be tested without a Canvas at all, and so the token handling
// stays where it belongs — the implementation (canvas.Service) is what
// decrypts it.
type CourseSource interface {
	CoursesFor(ctx context.Context, userID int64) ([]SourceCourse, error)
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
