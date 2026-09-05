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
