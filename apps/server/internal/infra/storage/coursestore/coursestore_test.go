package coursestore_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/coursestore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// L6 cases: the adapter against a real SQLite file with the shipped
// migrations applied, like authstore_test. What is worth asserting here is
// what the database does — the UNIQUE that turns a double-click into a
// refusal, and the DEFAULT timestamps a caller would otherwise render as
// 1970.

func store(t *testing.T) (context.Context, *sql.DB, *coursestore.Store) {
	t.Helper()

	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return ctx, db, coursestore.New(db)
}

func aCourse(canvasID string) roster.Course {
	return roster.Course{
		Name:           "ESTRUCTURAS DE DATOS Y ALGORITMOS",
		Code:           "CIT2006_CA01",
		Term:           "2026-2",
		CanvasCourseID: canvasID,
	}
}

func TestTheStoreSatisfiesTheDomainInterface(t *testing.T) {
	var _ roster.Store = (*coursestore.Store)(nil)
}

func TestCreateCourseReturnsTheRowTheDatabaseActuallyHolds(t *testing.T) {
	ctx, _, s := store(t)

	created, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}
	if created.ID == 0 {
		t.Error("the created course has no id")
	}
	if created.Name != "ESTRUCTURAS DE DATOS Y ALGORITMOS" || created.Code != "CIT2006_CA01" ||
		created.Term != "2026-2" || created.CanvasCourseID != "44779" {
		t.Errorf("created = %+v, want the fields as passed", created)
	}
	// The timestamps are the schema's DEFAULT (unixepoch()), which is why
	// the store reads the row back instead of returning what it was given.
	// A caller rendering a zero time would show 1 January 1970.
	if created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
		t.Errorf("timestamps are zero: created_at=%v updated_at=%v", created.CreatedAt, created.UpdatedAt)
	}
	if created.CreatedAt.Year() < 2020 {
		t.Errorf("created_at = %v, want a real time", created.CreatedAt)
	}
}

// The double-click, and the schema's UNIQUE doing the deciding. There is no
// preflight SELECT on purpose: it would be a race window, and the driver's
// refusal is the authority.
func TestCreateCourseRefusesACanvasCourseThatIsAlreadyStored(t *testing.T) {
	ctx, _, s := store(t)

	if _, err := s.CreateCourse(ctx, aCourse("44779")); err != nil {
		t.Fatalf("CreateCourse (first): %v", err)
	}

	_, err := s.CreateCourse(ctx, aCourse("44779"))
	if !errors.Is(err, roster.ErrAlreadyAdded) {
		t.Fatalf("CreateCourse (second) returned %v, want roster.ErrAlreadyAdded", err)
	}
	// The driver's text does not leak upwards: a handler branching on a
	// string would be reading SQLite's opinion.
	if errors.Is(err, roster.ErrCourseNotFound) {
		t.Error("a duplicate was reported as a missing course")
	}

	courses, err := s.ListCourses(ctx)
	if err != nil {
		t.Fatalf("ListCourses: %v", err)
	}
	if len(courses) != 1 {
		t.Errorf("the table holds %d courses after a duplicate insert, want 1", len(courses))
	}
}

// Two DIFFERENT Canvas courses that share a code are both stored: a
// professor teaches CIT2006_CA01 in 2023 and again in 2026, and the
// identity is the Canvas id, never the code.
func TestTwoCoursesMayShareACode(t *testing.T) {
	ctx, _, s := store(t)

	if _, err := s.CreateCourse(ctx, aCourse("44779")); err != nil {
		t.Fatalf("CreateCourse (2026): %v", err)
	}
	older := aCourse("23334")
	older.Term = "2023-2"
	if _, err := s.CreateCourse(ctx, older); err != nil {
		t.Errorf("a second course with the same code was refused: %v", err)
	}
}

func TestListCoursesReturnsTheMostRecentlyCreatedFirst(t *testing.T) {
	ctx, db, s := store(t)

	first, err := s.CreateCourse(ctx, aCourse("23334"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}
	// Backdate the first so the ordering is decided by created_at rather
	// than by two rows landing in the same second and falling through to
	// the id tie-break.
	if _, err := db.ExecContext(ctx,
		`UPDATE course SET created_at = created_at - 86400 WHERE id = ?`, first.ID); err != nil {
		t.Fatalf("backdating: %v", err)
	}
	second, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	courses, err := s.ListCourses(ctx)
	if err != nil {
		t.Fatalf("ListCourses: %v", err)
	}
	if len(courses) != 2 {
		t.Fatalf("got %d courses, want 2", len(courses))
	}
	if courses[0].ID != second.ID || courses[1].ID != first.ID {
		t.Errorf("order = %d, %d; want the most recent first (%d, %d)",
			courses[0].ID, courses[1].ID, second.ID, first.ID)
	}
}

func TestListCoursesOnAnEmptyTableIsEmptyRatherThanNil(t *testing.T) {
	ctx, _, s := store(t)

	courses, err := s.ListCourses(ctx)
	if err != nil {
		t.Fatalf("ListCourses: %v", err)
	}
	if courses == nil {
		t.Error("ListCourses returned nil; a caller ranging over it should not have to nil-check")
	}
	if len(courses) != 0 {
		t.Errorf("got %d courses from an empty table", len(courses))
	}
}

func TestCourseByIDReportsErrCourseNotFoundForAnIdNothingAnswersTo(t *testing.T) {
	ctx, _, s := store(t)

	_, err := s.CourseByID(ctx, 4242)
	if !errors.Is(err, roster.ErrCourseNotFound) {
		t.Errorf("CourseByID returned %v, want roster.ErrCourseNotFound", err)
	}
	// Absence speaks the domain's vocabulary, never database/sql's.
	if errors.Is(err, sql.ErrNoRows) {
		t.Error("CourseByID leaked database/sql's sentinel to its caller")
	}
}
