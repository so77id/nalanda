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

// --- SaveRoster (S6) -----------------------------------------------------

func aStudent(canvasUserID, rut, dv, lastName string) roster.SourceStudent {
	return roster.SourceStudent{
		FirstName:          "NOMBRE",
		LastName:           lastName,
		Email:              "x@mail.udp.cl",
		RUT:                rut,
		RUTDV:              dv,
		CanvasUserID:       canvasUserID,
		CanvasEnrollmentID: "e" + canvasUserID,
	}
}

func TestSaveRosterInsertsEveryStudentAndEnrolsThem(t *testing.T) {
	ctx, _, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	result, err := s.SaveRoster(ctx, course.ID, []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	})
	if err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	if result.Added != 2 || result.Updated != 0 || result.Withdrawn != 0 || result.WithoutRUT != 0 {
		t.Errorf("result = %+v, want 2 added and nothing else", result)
	}

	enrollments, err := s.ListEnrollments(ctx, course.ID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if len(enrollments) != 2 {
		t.Fatalf("got %d enrolments, want 2", len(enrollments))
	}
	// Surname order — the order a professor reads a class list in.
	if enrollments[0].Student.LastName != "PEREZ SOTO" {
		t.Errorf("first enrolment is %q, want the alphabetically first surname",
			enrollments[0].Student.LastName)
	}
	if enrollments[0].State != roster.StateEnrolled {
		t.Errorf("state = %q, want %q", enrollments[0].State, roster.StateEnrolled)
	}
	if enrollments[1].Student.RUT != "11222444" || enrollments[1].Student.RUTDV != "K" {
		t.Errorf("RUT = %q-%q, want the K verifier preserved",
			enrollments[1].Student.RUT, enrollments[1].Student.RUTDV)
	}
}

// AC-11: running the import twice yields the same state. The second run
// updates rather than duplicating, and withdraws nobody.
func TestSaveRosterIsIdempotent(t *testing.T) {
	ctx, db, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}
	students := []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	}

	if _, err := s.SaveRoster(ctx, course.ID, students); err != nil {
		t.Fatalf("SaveRoster (first): %v", err)
	}
	second, err := s.SaveRoster(ctx, course.ID, students)
	if err != nil {
		t.Fatalf("SaveRoster (second): %v", err)
	}
	if second.Added != 0 || second.Updated != 2 || second.Withdrawn != 0 {
		t.Errorf("second run = %+v, want 2 updated and nothing added or withdrawn", second)
	}

	for table, want := range map[string]int{"student": 2, "enrollment": 2} {
		var rows int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&rows); err != nil {
			t.Fatalf("counting %s: %v", table, err)
		}
		if rows != want {
			t.Errorf("%s holds %d rows after two imports, want %d", table, rows, want)
		}
	}
}

func TestSaveRosterRefreshesAStudentWhoseDetailsChanged(t *testing.T) {
	ctx, _, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	if _, err := s.SaveRoster(ctx, course.ID, []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "CAMUS"),
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}

	changed := aStudent("900001", "11222333", "5", "PEREZ SOTO")
	changed.Email = "nuevo@mail.udp.cl"
	if _, err := s.SaveRoster(ctx, course.ID, []roster.SourceStudent{changed}); err != nil {
		t.Fatalf("SaveRoster (changed): %v", err)
	}

	enrollments, err := s.ListEnrollments(ctx, course.ID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if len(enrollments) != 1 {
		t.Fatalf("got %d enrolments, want 1", len(enrollments))
	}
	if enrollments[0].Student.LastName != "PEREZ SOTO" || enrollments[0].Student.Email != "nuevo@mail.udp.cl" {
		t.Errorf("the student was not refreshed: %+v", enrollments[0].Student)
	}
}

// A student Canvas no longer lists is stamped withdrawn, NEVER deleted:
// their grades hang off the RUT match in WP-2, and a student who dropped
// still sat the controls they sat.
func TestSaveRosterWithdrawsAStudentCanvasNoLongerListsWithoutDeletingThem(t *testing.T) {
	ctx, db, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	if _, err := s.SaveRoster(ctx, course.ID, []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}

	// The second student dropped the course.
	result, err := s.SaveRoster(ctx, course.ID, []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "PEREZ SOTO"),
	})
	if err != nil {
		t.Fatalf("SaveRoster (after the drop): %v", err)
	}
	if result.Withdrawn != 1 || result.Updated != 1 || result.Added != 0 {
		t.Errorf("result = %+v, want 1 updated and 1 withdrawn", result)
	}

	var students int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM student`).Scan(&students); err != nil {
		t.Fatalf("counting students: %v", err)
	}
	if students != 2 {
		t.Errorf("the withdrawn student's PERSON row was deleted: %d rows, want 2", students)
	}

	enrollments, err := s.ListEnrollments(ctx, course.ID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if len(enrollments) != 2 {
		t.Fatalf("got %d enrolments, want both kept", len(enrollments))
	}
	// Enrolled first, withdrawn after — the order the roster page reads in.
	if enrollments[0].State != roster.StateEnrolled || enrollments[1].State != roster.StateWithdrawn {
		t.Errorf("states = %q, %q; want enrolled first", enrollments[0].State, enrollments[1].State)
	}
}

// The withdrawn count means "this import withdrew N", not "N are
// withdrawn". Re-importing the same shorter roster must not re-count them.
func TestWithdrawnIsCountedOncePerImportNotOncePerRun(t *testing.T) {
	ctx, _, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}
	if _, err := s.SaveRoster(ctx, course.ID, []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}

	shorter := []roster.SourceStudent{aStudent("900001", "11222333", "5", "PEREZ SOTO")}
	if _, err := s.SaveRoster(ctx, course.ID, shorter); err != nil {
		t.Fatalf("SaveRoster (shorter): %v", err)
	}
	again, err := s.SaveRoster(ctx, course.ID, shorter)
	if err != nil {
		t.Fatalf("SaveRoster (shorter, again): %v", err)
	}
	if again.Withdrawn != 0 {
		t.Errorf("the second run reported %d withdrawn, want 0 — they were already withdrawn", again.Withdrawn)
	}
}

// A student who dropped and came back is enrolled again by the next
// import, rather than staying withdrawn forever.
func TestAStudentWhoReturnsIsEnrolledAgain(t *testing.T) {
	ctx, _, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}
	present := []roster.SourceStudent{aStudent("900001", "11222333", "5", "PEREZ SOTO")}

	if _, err := s.SaveRoster(ctx, course.ID, present); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	if _, err := s.SaveRoster(ctx, course.ID, nil); err != nil {
		t.Fatalf("SaveRoster (empty): %v", err)
	}
	if _, err := s.SaveRoster(ctx, course.ID, present); err != nil {
		t.Fatalf("SaveRoster (returned): %v", err)
	}

	enrollments, err := s.ListEnrollments(ctx, course.ID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if len(enrollments) != 1 || enrollments[0].State != roster.StateEnrolled {
		t.Errorf("enrolments = %+v, want the returning student enrolled again", enrollments)
	}
}

// A student Canvas has no readable RUT for is imported anyway, with both
// columns null, and counted — the one outcome that looks like success and
// is not (ADR-0069 §Decision 2).
func TestSaveRosterImportsAStudentWithNoRutAndCountsThem(t *testing.T) {
	ctx, _, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	result, err := s.SaveRoster(ctx, course.ID, []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "PEREZ SOTO"),
		aStudent("99999", "", "", "EXTRANJERA"),
	})
	if err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	if result.Added != 2 {
		t.Errorf("Added = %d, want both students imported", result.Added)
	}
	if result.WithoutRUT != 1 {
		t.Errorf("WithoutRUT = %d, want 1", result.WithoutRUT)
	}

	enrollments, err := s.ListEnrollments(ctx, course.ID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	for _, e := range enrollments {
		if e.Student.LastName == "EXTRANJERA" && e.Student.HasRUT() {
			t.Errorf("the RUT-less student came back with %q", e.Student.RUT)
		}
	}
}

// Two students with no RUT do not collide: SQLite lets any number of NULLs
// coexist under a UNIQUE, which is the whole reason the column is nullable
// and refuses the empty string.
func TestTwoStudentsWithNoRutBothImport(t *testing.T) {
	ctx, _, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	result, err := s.SaveRoster(ctx, course.ID, []roster.SourceStudent{
		aStudent("99998", "", "", "UNA"),
		aStudent("99999", "", "", "OTRA"),
	})
	if err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	if result.Added != 2 || result.WithoutRUT != 2 {
		t.Errorf("result = %+v, want both imported and both counted", result)
	}
}

// Two DIFFERENT Canvas users carrying the same RUT is refused rather than
// resolved: that column is the key WP-2 matches grades on, and picking one
// of the two silently would deliver somebody's grade to somebody else.
func TestSaveRosterRefusesTwoCanvasUsersWithTheSameRut(t *testing.T) {
	ctx, db, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	_, err = s.SaveRoster(ctx, course.ID, []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "UNA"),
		aStudent("900002", "11222333", "5", "OTRA"),
	})
	if !errors.Is(err, roster.ErrDuplicateRUT) {
		t.Fatalf("SaveRoster returned %v, want roster.ErrDuplicateRUT", err)
	}

	// And the whole import rolled back — not the first student without the
	// second. A half-applied roster looks like a class where people
	// vanished.
	for _, table := range []string{"student", "enrollment"} {
		var rows int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&rows); err != nil {
			t.Fatalf("counting %s: %v", table, err)
		}
		if rows != 0 {
			t.Errorf("%s holds %d rows after a failed import, want 0 — the transaction did not roll back", table, rows)
		}
	}
}

// A person on two courses is ONE student row with two enrolments — the
// §Entities rule that a student is a person, not a membership.
func TestAStudentOnTwoCoursesIsOnePerson(t *testing.T) {
	ctx, db, s := store(t)
	first, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}
	second, err := s.CreateCourse(ctx, aCourse("44780"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	student := []roster.SourceStudent{aStudent("900001", "11222333", "5", "PEREZ SOTO")}
	for _, course := range []roster.Course{first, second} {
		if _, err := s.SaveRoster(ctx, course.ID, student); err != nil {
			t.Fatalf("SaveRoster on course %d: %v", course.ID, err)
		}
	}

	var students, enrollments int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM student`).Scan(&students); err != nil {
		t.Fatalf("counting students: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM enrollment`).Scan(&enrollments); err != nil {
		t.Fatalf("counting enrolments: %v", err)
	}
	if students != 1 {
		t.Errorf("the same person produced %d student rows, want 1", students)
	}
	if enrollments != 2 {
		t.Errorf("got %d enrolments, want one per course", enrollments)
	}
}

// Importing one course must not withdraw the other course's people.
func TestSaveRosterOnlyWithdrawsItsOwnCourse(t *testing.T) {
	ctx, _, s := store(t)
	first, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}
	second, err := s.CreateCourse(ctx, aCourse("44780"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	if _, err := s.SaveRoster(ctx, first.ID, []roster.SourceStudent{
		aStudent("900001", "11222333", "5", "PEREZ SOTO"),
	}); err != nil {
		t.Fatalf("SaveRoster on the first course: %v", err)
	}
	// A completely different roster on the second course.
	if _, err := s.SaveRoster(ctx, second.ID, []roster.SourceStudent{
		aStudent("900002", "11222444", "K", "MUÑOZ ÁVILA"),
	}); err != nil {
		t.Fatalf("SaveRoster on the second course: %v", err)
	}

	enrollments, err := s.ListEnrollments(ctx, first.ID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if len(enrollments) != 1 || enrollments[0].State != roster.StateEnrolled {
		t.Errorf("the first course's enrolment was disturbed: %+v", enrollments)
	}
}

func TestListEnrollmentsOnACourseWithNoRosterIsEmptyRatherThanNil(t *testing.T) {
	ctx, _, s := store(t)
	course, err := s.CreateCourse(ctx, aCourse("44779"))
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}

	enrollments, err := s.ListEnrollments(ctx, course.ID)
	if err != nil {
		t.Fatalf("ListEnrollments: %v", err)
	}
	if enrollments == nil {
		t.Error("ListEnrollments returned nil; a caller ranging over it should not have to nil-check")
	}
	if len(enrollments) != 0 {
		t.Errorf("got %d enrolments on a fresh course", len(enrollments))
	}
}
