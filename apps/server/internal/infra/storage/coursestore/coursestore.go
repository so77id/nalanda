// Package coursestore is the SQLite side of the roster domain: one type
// implementing roster.Store over the `course` table migration 00014
// creates.
//
// It lives under internal/infra/storage beside authstore, controlstore,
// jobstore and secretstore, for the reason ADR-0034 gives: store
// implementations sit beneath the domain, and `storage` itself stays about
// opening a database and applying migrations.
//
// Times are unix SECONDS, because that is what the columns hold — a caller
// handing in a time with a fractional part gets it back truncated, the same
// contract authstore documents.
package coursestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
)

// Store is the adapter.
type Store struct {
	db *sql.DB
}

// New returns a Store over db. The caller owns the handle and its lifetime.
func New(db *sql.DB) *Store {
	return &Store{db: db}
}

// The domain's interface, satisfied at compile time — the storage.Prober
// shape.
var _ roster.Store = (*Store)(nil)

// CreateCourse inserts the row and returns it with its id.
//
// A Canvas course already stored comes back as roster.ErrAlreadyAdded
// rather than as the driver's UNIQUE-violation text. There is deliberately
// NO preflight SELECT: that would be a race window between the check and
// the insert, and the schema's UNIQUE is what actually decides. Same shape,
// and the same reasoning, as authstore's duplicate-email handling
// (backend-code-style.md §Form / validation / errors, "a preflight SELECT
// would be a race window and is not the pattern").
func (s *Store) CreateCourse(ctx context.Context, c roster.Course) (roster.Course, error) {
	result, err := s.db.ExecContext(ctx, `
        INSERT INTO course (name, code, term, canvas_course_id)
        VALUES (?, ?, ?, ?)`,
		c.Name, c.Code, c.Term, c.CanvasCourseID)
	if err != nil {
		if isDuplicateCanvasCourse(err) {
			return roster.Course{}, fmt.Errorf("%w: %s", roster.ErrAlreadyAdded, c.CanvasCourseID)
		}
		return roster.Course{}, fmt.Errorf("coursestore: insert the course: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return roster.Course{}, fmt.Errorf("coursestore: read the inserted course id: %w", err)
	}
	// Read back rather than returning what was passed in: created_at and
	// updated_at are the database's DEFAULT (unixepoch()), and a caller
	// that rendered a zero time would show "1 de enero de 1970".
	return s.CourseByID(ctx, id)
}

// ListCourses returns every course, most recently created first.
func (s *Store) ListCourses(ctx context.Context) ([]roster.Course, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT id, name, code, term, canvas_course_id, created_at, updated_at
        FROM course
        ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("coursestore: list the courses: %w", err)
	}
	defer func() { _ = rows.Close() }()

	courses := []roster.Course{}
	for rows.Next() {
		course, err := scanCourse(rows)
		if err != nil {
			return nil, fmt.Errorf("coursestore: scan a course: %w", err)
		}
		courses = append(courses, course)
	}
	// Checked rather than assumed: a driver error mid-iteration ends the
	// loop silently, and a truncated list would read as "the professor has
	// fewer courses than they do".
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("coursestore: read the courses: %w", err)
	}
	return courses, nil
}

// CourseByID returns one course, or roster.ErrCourseNotFound.
func (s *Store) CourseByID(ctx context.Context, id int64) (roster.Course, error) {
	row := s.db.QueryRowContext(ctx, `
        SELECT id, name, code, term, canvas_course_id, created_at, updated_at
        FROM course WHERE id = ?`, id)

	course, err := scanCourse(row)
	if errors.Is(err, sql.ErrNoRows) {
		return roster.Course{}, fmt.Errorf("coursestore: course %d: %w", id, roster.ErrCourseNotFound)
	}
	if err != nil {
		return roster.Course{}, fmt.Errorf("coursestore: read course %d: %w", id, err)
	}
	return course, nil
}

func scanCourse(row interface{ Scan(...any) error }) (roster.Course, error) {
	var (
		c                  roster.Course
		createdAt, updated int64
	)
	if err := row.Scan(&c.ID, &c.Name, &c.Code, &c.Term, &c.CanvasCourseID, &createdAt, &updated); err != nil {
		return roster.Course{}, err
	}
	c.CreatedAt = time.Unix(createdAt, 0).UTC()
	c.UpdatedAt = time.Unix(updated, 0).UTC()
	return c, nil
}

// isDuplicateCanvasCourse matches the UNIQUE violation on
// course.canvas_course_id.
//
// It reads the driver's message because modernc.org/sqlite does not expose
// a typed constraint error, which is the same reason authstore's
// isDuplicateEmail does. The COLUMN is named in the match, not just
// "UNIQUE": a future second unique index on this table would otherwise be
// reported to the professor as "ya lo agregaste".
func isDuplicateCanvasCourse(err error) bool {
	text := err.Error()
	return strings.Contains(text, "UNIQUE constraint failed") &&
		strings.Contains(text, "course.canvas_course_id")
}

// SaveRoster applies one import to one course, in ONE transaction.
//
// Atomic on purpose. A half-applied roster looks exactly like a class where
// some students vanished, and the professor has no way to tell which half
// arrived — so either the whole import lands or none of it does, and a
// failure leaves the previous roster intact to be re-imported.
//
// Three steps, in this order:
//
//  1. Upsert each PERSON on canvas_user_id. That key, not the RUT: the RUT
//     may be absent (ADR-0069 §Decision 1), and keying on it would insert a
//     second row for every student Canvas has no RUT for, on every import.
//  2. Upsert each ENROLMENT on (course_id, student_id), always as enrolled
//     — this is what brings a student who came back off `withdrawn`.
//  3. Stamp `withdrawn` on every enrolment of this course that step 2 did
//     not touch. Never DELETE: their grades hang off the RUT match in WP-2,
//     and a student who dropped still sat the controls they sat.
func (s *Store) SaveRoster(ctx context.Context, courseID int64, students []roster.SourceStudent) (roster.ImportResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return roster.ImportResult{}, fmt.Errorf("coursestore: begin the roster transaction: %w", err)
	}
	// Rolls back unless Commit already succeeded, in which case it is a
	// no-op returning sql.ErrTxDone — which is why the error is discarded
	// deliberately rather than ignored (backend-code-style.md §Errors).
	defer func() { _ = tx.Rollback() }()

	result := roster.ImportResult{}
	keep := make([]any, 0, len(students))
	seen := make(map[string]bool, len(students))

	for _, incoming := range students {
		// One person, one row, however many times the source listed them.
		// Canvas returns a node per ENROLMENT, so a student in two sections
		// of one course arrives twice; without this the upsert wrote them
		// once (correctly) but the per-student `existing` probe then saw the
		// enrolment the first pass had just created, so the second landed in
		// Updated and the flash told the professor their class had one more
		// student than it does (#271 review, COR-8).
		if seen[incoming.CanvasUserID] {
			continue
		}
		seen[incoming.CanvasUserID] = true

		studentID, err := upsertStudent(ctx, tx, incoming)
		if err != nil {
			return roster.ImportResult{}, err
		}
		if incoming.RUT == "" {
			result.WithoutRUT++
		}

		// Whether this is a new enrolment or a refreshed one is decided
		// BEFORE the upsert: afterwards the row exists either way, and
		// "added" and "updated" would be indistinguishable.
		var existing int
		if err := tx.QueryRowContext(ctx,
			`SELECT count(*) FROM enrollment WHERE course_id = ? AND student_id = ?`,
			courseID, studentID,
		).Scan(&existing); err != nil {
			return roster.ImportResult{}, fmt.Errorf("coursestore: look for an existing enrolment: %w", err)
		}

		if _, err := tx.ExecContext(ctx, `
            INSERT INTO enrollment (course_id, student_id, state, canvas_enrollment_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (course_id, student_id) DO UPDATE SET
                state = excluded.state,
                canvas_enrollment_id = excluded.canvas_enrollment_id,
                updated_at = unixepoch()`,
			courseID, studentID, roster.StateEnrolled, nullableText(incoming.CanvasEnrollmentID),
		); err != nil {
			return roster.ImportResult{}, fmt.Errorf("coursestore: upsert an enrolment: %w", err)
		}

		if existing == 0 {
			result.Added++
		} else {
			result.Updated++
		}
		keep = append(keep, studentID)
	}

	withdrawn, err := withdrawAbsent(ctx, tx, courseID, keep)
	if err != nil {
		return roster.ImportResult{}, err
	}
	result.Withdrawn = withdrawn

	if err := tx.Commit(); err != nil {
		return roster.ImportResult{}, fmt.Errorf("coursestore: commit the roster: %w", err)
	}
	return result, nil
}

// upsertStudent inserts or refreshes one person and returns their id.
//
// The conflict target is canvas_user_id — see SaveRoster's step 1 on why
// not the RUT. A UNIQUE violation on the RUT means two DIFFERENT Canvas
// users carry the same one, which is refused rather than resolved: that
// column is the key WP-2 matches grades on, and picking one of the two
// silently would deliver somebody's grade to somebody else.
func upsertStudent(ctx context.Context, tx *sql.Tx, in roster.SourceStudent) (int64, error) {
	_, err := tx.ExecContext(ctx, `
        INSERT INTO student (first_name, last_name, email, rut, rut_dv, canvas_user_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (canvas_user_id) DO UPDATE SET
            first_name = excluded.first_name,
            last_name  = excluded.last_name,
            email      = excluded.email,
            rut        = excluded.rut,
            rut_dv     = excluded.rut_dv,
            updated_at = unixepoch()`,
		in.FirstName, in.LastName, in.Email,
		nullableText(in.RUT), nullableText(in.RUTDV), in.CanvasUserID)
	if err != nil {
		if isDuplicateRUT(err) {
			return 0, fmt.Errorf("%w: canvas user %s", roster.ErrDuplicateRUT, in.CanvasUserID)
		}
		return 0, fmt.Errorf("coursestore: upsert a student: %w", err)
	}

	// Read the id back rather than using LastInsertId: on the UPDATE branch
	// of an upsert that value is not the row's.
	var id int64
	if err := tx.QueryRowContext(ctx,
		`SELECT id FROM student WHERE canvas_user_id = ?`, in.CanvasUserID).Scan(&id); err != nil {
		return 0, fmt.Errorf("coursestore: read the upserted student's id: %w", err)
	}
	return id, nil
}

// withdrawAbsent stamps every enrolment of the course that this import did
// not touch, and returns how many changed.
//
// Scoped to rows that are currently `enrolled`, so re-importing twice does
// not re-count the same people as newly withdrawn — the count in the flash
// has to mean "this import withdrew N", not "N are withdrawn".
func withdrawAbsent(ctx context.Context, tx *sql.Tx, courseID int64, keep []any) (int, error) {
	query := `UPDATE enrollment SET state = ?, updated_at = unixepoch()
              WHERE course_id = ? AND state = ?`
	args := []any{roster.StateWithdrawn, courseID, roster.StateEnrolled}

	if len(keep) > 0 {
		// Built from a counted list of placeholders, never from the ids
		// themselves: the values travel as parameters, so no identifier
		// reaches the SQL text.
		query += ` AND student_id NOT IN (?` + strings.Repeat(", ?", len(keep)-1) + `)`
		args = append(args, keep...)
	}

	result, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("coursestore: withdraw the absent enrolments: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("coursestore: count the withdrawn enrolments: %w", err)
	}
	return int(affected), nil
}

// ListEnrollments returns the course's people, in NO PARTICULAR ORDER.
//
// The ordering is roster.Service.Enrollments's job, not this method's, and
// the port says so. It was briefly applied here, which made "enrolled
// first, then by folded surname" an obligation every future implementer of
// roster.Store had to remember: deleting the call left the whole domain
// package green, guarded only by this adapter's own two cases (#271 review,
// ARQ-9). A policy the domain owns belongs where the domain can test it.
//
// What must NOT come back is an ORDER BY in the SQL. SQLite's BINARY
// collation sorts every accented surname after every unaccented one, so
// `ÁVILA MUÑOZ` came after `ZUNIGA PEREZ` on a real roster (COR-7) — and
// the query LOOKS correct, which is what made it survive review the first
// time.
func (s *Store) ListEnrollments(ctx context.Context, courseID int64) ([]roster.Enrollment, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT e.id, e.course_id, e.state, e.canvas_enrollment_id,
               s.id, s.first_name, s.last_name, s.email, s.rut, s.rut_dv, s.canvas_user_id
        FROM enrollment e
        JOIN student s ON s.id = e.student_id
        WHERE e.course_id = ?`,
		courseID)
	if err != nil {
		return nil, fmt.Errorf("coursestore: list the enrolments: %w", err)
	}
	defer func() { _ = rows.Close() }()

	enrollments := []roster.Enrollment{}
	for rows.Next() {
		var (
			e           roster.Enrollment
			canvasEnrol sql.NullString
			rut, rutDV  sql.NullString
		)
		if err := rows.Scan(&e.ID, &e.CourseID, &e.State, &canvasEnrol,
			&e.Student.ID, &e.Student.FirstName, &e.Student.LastName, &e.Student.Email,
			&rut, &rutDV, &e.Student.CanvasUserID); err != nil {
			return nil, fmt.Errorf("coursestore: scan an enrolment: %w", err)
		}
		e.CanvasEnrollmentID = canvasEnrol.String
		e.Student.RUT = rut.String
		e.Student.RUTDV = rutDV.String
		enrollments = append(enrollments, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("coursestore: read the enrolments: %w", err)
	}
	return enrollments, nil
}

// nullableText maps "" onto SQL NULL.
//
// Load-bearing for the RUT pair: the schema's CHECK admits NULL or eight
// digits, never the empty string, precisely so an "unknown" value cannot
// collide with another unknown under the UNIQUE (ADR-0069 §Decision 1).
// Writing "" here would fail every import that meets a student Canvas has
// no RUT for.
func nullableText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// isDuplicateRUT matches the UNIQUE violation on student.rut. Named by
// column for the same reason isDuplicateCanvasCourse is.
func isDuplicateRUT(err error) bool {
	text := err.Error()
	return strings.Contains(text, "UNIQUE constraint failed") &&
		strings.Contains(text, "student.rut")
}

// EnrollmentCounts tallies every course's enrolments in one statement.
//
// GROUP BY (course_id, state) rather than a count per course: it answers the
// list screen's whole question in one round trip, and a course with no rows
// simply has no entry — which is what preserves the "sin lista" vs "0
// inscritos" distinction the screen depends on.
//
// The plan is a covering-index scan of idx_enrollment_by_course, so it never
// touches the enrollment table itself.
func (s *Store) EnrollmentCounts(ctx context.Context) (map[int64]roster.EnrollmentCounts, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT course_id, state, count(*)
        FROM enrollment
        GROUP BY course_id, state`)
	if err != nil {
		return nil, fmt.Errorf("coursestore: count the enrolments: %w", err)
	}
	defer func() { _ = rows.Close() }()

	counts := map[int64]roster.EnrollmentCounts{}
	for rows.Next() {
		var (
			courseID int64
			state    string
			n        int
		)
		if err := rows.Scan(&courseID, &state, &n); err != nil {
			return nil, fmt.Errorf("coursestore: scan an enrolment count: %w", err)
		}
		tally := counts[courseID]
		switch state {
		case roster.StateEnrolled:
			tally.Enrolled = n
		case roster.StateWithdrawn:
			tally.Withdrawn = n
		}
		counts[courseID] = tally
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("coursestore: read the enrolment counts: %w", err)
	}
	return counts, nil
}
