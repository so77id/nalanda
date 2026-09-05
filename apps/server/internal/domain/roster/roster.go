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
	"sort"
	"strings"
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

	// ListEnrollments returns the course's people, in ANY ORDER. Ordering is
	// Service.Enrollments's job — see SortEnrollments on why SQLite's
	// collation cannot do it, and #271 review ARQ-9 on why an implementer
	// must not be trusted to remember.
	ListEnrollments(ctx context.Context, courseID int64) ([]Enrollment, error)

	// EnrollmentCounts returns, per course id, how many people are enrolled
	// and how many withdrew. A course with NO roster at all has no entry —
	// which is what lets the list say "sin lista" rather than "0 inscritos",
	// two states a bare number cannot tell apart.
	//
	// It exists so the list screen asks one question instead of one per
	// course. The screen previously reached through this domain into the
	// store and loaded every student row to count them (#271 review, ARQ-1);
	// the cost was negligible and the boundary was not.
	EnrollmentCounts(ctx context.Context) (map[int64]EnrollmentCounts, error)
}

// EnrollmentCounts is one course's tally.
type EnrollmentCounts struct {
	Enrolled  int
	Withdrawn int
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

// CourseWithCounts is a course and its tally, for the list screen.
type CourseWithCounts struct {
	Course Course
	// Counts is the tally; HasRoster says whether the course has been
	// imported at all, which is the distinction Counts alone cannot carry.
	Counts    EnrollmentCounts
	HasRoster bool
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

// SortEnrollments orders a course's people the way a professor reads a
// class list: those still enrolled first, then by surname, then by given
// name.
//
// It sorts in Go rather than in SQL because SQLite's default BINARY
// collation puts every accented surname after every unaccented one — Á is
// 0xC3 0x81 and Z is 0x5A, so `ÁVILA MUÑOZ` sorted after `ZUNIGA PEREZ`
// (#271 review, COR-7, measured). ADR-0069 recorded that Canvas hands names
// uppercase WITH their accents, and ÁLVAREZ, ÁVILA and ÓRDENES are ordinary
// Chilean surnames, so this was not a corner case — it was most of the
// alphabet's tail landing in the wrong place on every roster page.
//
// SQLite's `COLLATE NOCASE` would not have helped: it folds ASCII case
// only, and this is a diacritic problem, not a case problem. `ICU` would,
// and is an extension this build cannot load (ADR-0007 pins a pure-Go,
// CGO-free driver).
func SortEnrollments(enrollments []Enrollment) {
	// Decorate, sort, undecorate. The fold used to run inside the
	// comparator, which called it ~30 times per student instead of twice
	// and allocated on every call — strings.Replacer builds a buffer even
	// when nothing matches. Measured at 400 students: 1.32 ms and 36,270
	// allocations, against 139 µs and 2,405 this way, for a byte-identical
	// order (#271 recheck, PER-5).
	type keyed struct {
		enrollment Enrollment
		enrolled   bool
		last       string
		first      string
	}
	rows := make([]keyed, len(enrollments))
	for i, e := range enrollments {
		rows[i] = keyed{
			enrollment: e,
			enrolled:   e.State == StateEnrolled,
			last:       foldForSort(e.Student.LastName),
			first:      foldForSort(e.Student.FirstName),
		}
	}

	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.enrolled != b.enrolled {
			return a.enrolled
		}
		if a.last != b.last {
			return a.last < b.last
		}
		if a.first != b.first {
			return a.first < b.first
		}
		// The final tie-break makes the order TOTAL. Without it two people
		// whose folded names are equal — MUÑOZ and MUNOZ — keep whatever
		// order the store's scan produced, and the withdraw UPDATE rewrites
		// rows, so a tied pair could swap between page loads (COR-NEW-3).
		return a.enrollment.Student.ID < b.enrollment.Student.ID
	})

	for i, r := range rows {
		enrollments[i] = r.enrollment
	}
}

// foldAccents maps the Latin-1 letters Chilean names actually use onto
// their unaccented equivalents. Deliberately small: a general Unicode
// normalisation would be a dependency (golang.org/x/text), and go.mod is a
// PR discussion in this repo.
var foldAccents = strings.NewReplacer(
	"Á", "A", "á", "a",
	"É", "E", "é", "e",
	"Í", "I", "í", "i",
	"Ó", "O", "ó", "o",
	"Ú", "U", "ú", "u",
	"Ü", "U", "ü", "u",
	"Ñ", "N", "ñ", "n",
)

// foldForSort is the sort key: accents folded and case flattened, so
// "ÁVILA", "Ávila" and "avila" sort together.
func foldForSort(s string) string {
	return strings.ToUpper(foldAccents.Replace(s))
}
