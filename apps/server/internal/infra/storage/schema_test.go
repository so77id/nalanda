package storage_test

import (
	"bytes"
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// The auth schema is asserted here rather than trusted to review because every
// rule it carries fails SILENTLY when it is absent: a foreign key SQLite is not
// enforcing keeps the rows it should reject, and a missing unique index shows up
// as a second professor with the same email rather than as an error.
//
// These cases run against the migrations the binary actually ships, applied to a
// fresh file — the same premise as TestTheEmbeddedMigrationsApplyToAFreshDatabase
// one file over, which covers the sequence rather than its contents.

// migrated opens a fresh database, applies the embedded set and hands back the
// handle. Fatal on any failure: a case that cannot reach its assertions has
// nothing to say about the schema.
func migrated(t *testing.T) (context.Context, *sql.DB) {
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
	return ctx, db
}

// insertProfessor adds a row to users and returns its id.
func insertProfessor(t *testing.T, ctx context.Context, db *sql.DB, email string) int64 {
	t.Helper()

	result, err := db.ExecContext(ctx,
		"INSERT INTO users (email, name) VALUES (?, ?)", email, "Profesora")
	if err != nil {
		t.Fatalf("inserting the professor %s: %v", email, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("reading the inserted id: %v", err)
	}
	return id
}

func TestTheAuthSchemaAcceptsAProfessorWithAnIdentityAndASession(t *testing.T) {
	ctx, db := migrated(t)

	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	if _, err := db.ExecContext(ctx,
		"INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)",
		userID, "google", "sub-1", "profesora@example.com",
	); err != nil {
		t.Fatalf("inserting the identity: %v", err)
	}

	if _, err := db.ExecContext(ctx,
		"INSERT INTO user_sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
		"hash-1", userID, "csrf-1", 4102444800,
	); err != nil {
		t.Fatalf("inserting the session: %v", err)
	}
}

// Two professors cannot share an email, and the check has to survive a
// difference in case: Google returns the address as the account holder typed it,
// so "Profesora@example.com" and "profesora@example.com" are one person and
// would otherwise be two rows, only one of which the login resolver would ever
// find.
func TestUsersRejectADuplicateEmailWhateverItsCase(t *testing.T) {
	ctx, db := migrated(t)

	insertProfessor(t, ctx, db, "profesora@example.com")

	if _, err := db.ExecContext(ctx,
		"INSERT INTO users (email, name) VALUES (?, ?)", "Profesora@Example.com", "Otra",
	); err == nil {
		t.Error("a second professor with the same email in another case was accepted, want a uniqueness error")
	}
}

// (provider, subject) is the login key, so a second row claiming the same Google
// account is what would let one identity resolve to two professors.
func TestAnOAuthIdentityIsUniquePerProviderAndSubject(t *testing.T) {
	ctx, db := migrated(t)

	first := insertProfessor(t, ctx, db, "una@example.com")
	second := insertProfessor(t, ctx, db, "otra@example.com")

	if _, err := db.ExecContext(ctx,
		"INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)",
		first, "google", "sub-shared", "una@example.com",
	); err != nil {
		t.Fatalf("inserting the first identity: %v", err)
	}

	if _, err := db.ExecContext(ctx,
		"INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)",
		second, "google", "sub-shared", "otra@example.com",
	); err == nil {
		t.Error("a second identity with the same (provider, subject) was accepted, want a uniqueness error")
	}
}

// The references are constraints, not documentation. This is the case that goes
// green on an unenforced schema, which is why storage.Open sets foreign_keys(1)
// and why sqlite_test.go asserts the pragma separately: both have to hold.
func TestTheAuthSchemaEnforcesItsReferences(t *testing.T) {
	ctx, db := migrated(t)

	for _, c := range []struct {
		name  string
		query string
		args  []any
	}{
		{
			name:  "identity of an unknown professor",
			query: "INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)",
			args:  []any{int64(4242), "google", "sub-orphan", "nadie@example.com"},
		},
		{
			name:  "session of an unknown professor",
			query: "INSERT INTO user_sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
			args:  []any{"hash-orphan", int64(4242), "csrf-orphan", 4102444800},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := db.ExecContext(ctx, c.query, c.args...)
			if err == nil {
				t.Fatal("the row was accepted, want a foreign-key error")
			}
			// Naming the constraint matters: before the schema existed, this
			// case passed on "no such table" — an error for the wrong reason is
			// how a guard goes green while verifying nothing.
			if !strings.Contains(err.Error(), "FOREIGN KEY") {
				t.Errorf("rejected with %v, want a FOREIGN KEY constraint failure", err)
			}
		})
	}
}

// Deleting a professor takes their identities and sessions with them. Without
// the cascade, a deleted professor's session row outlives them and the middleware
// resolves a cookie to a user that is no longer there.
func TestDeletingAProfessorRemovesTheirIdentitiesAndSessions(t *testing.T) {
	ctx, db := migrated(t)

	userID := insertProfessor(t, ctx, db, "profesora@example.com")
	if _, err := db.ExecContext(ctx,
		"INSERT INTO oauth_identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)",
		userID, "google", "sub-1", "profesora@example.com",
	); err != nil {
		t.Fatalf("inserting the identity: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		"INSERT INTO user_sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
		"hash-1", userID, "csrf-1", 4102444800,
	); err != nil {
		t.Fatalf("inserting the session: %v", err)
	}

	if _, err := db.ExecContext(ctx, "DELETE FROM users WHERE user_id = ?", userID); err != nil {
		t.Fatalf("deleting the professor: %v", err)
	}

	for _, table := range []string{"oauth_identities", "user_sessions"} {
		var rows int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&rows); err != nil {
			t.Fatalf("counting %s: %v", table, err)
		}
		if rows != 0 {
			t.Errorf("%s still holds %d row(s) after the professor was deleted, want 0", table, rows)
		}
	}
}

// The nullable last-sign-in column (migration 00003). A fresh professor has
// NULL; a written value survives a read.
func TestLastLoginAtIsNullableAndSurvivesARoundTrip(t *testing.T) {
	ctx, db := migrated(t)

	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	var initial sql.NullInt64
	if err := db.QueryRowContext(ctx,
		"SELECT last_login_at FROM users WHERE user_id = ?", userID).Scan(&initial); err != nil {
		t.Fatalf("reading last_login_at: %v", err)
	}
	if initial.Valid {
		t.Errorf("last_login_at is set for a fresh professor: %v", initial.Int64)
	}

	stamped := int64(1_755_360_000)
	if _, err := db.ExecContext(ctx,
		"UPDATE users SET last_login_at = ? WHERE user_id = ?", stamped, userID); err != nil {
		t.Fatalf("stamping last_login_at: %v", err)
	}

	var read sql.NullInt64
	if err := db.QueryRowContext(ctx,
		"SELECT last_login_at FROM users WHERE user_id = ?", userID).Scan(&read); err != nil {
		t.Fatalf("reading back last_login_at: %v", err)
	}
	if !read.Valid || read.Int64 != stamped {
		t.Errorf("last_login_at = %v, want %v", read, stamped)
	}
}

// The control table's state column is CHECK-guarded because the value is
// what the professor reads and what WP-F's lifecycle branches on: a typo
// silently accepted would put the row in a state nothing else recognises,
// with no schema-level signal.
func TestControlStateRefusesAnUnknownValue(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	_, err := db.ExecContext(ctx, `
        INSERT INTO control (
            id, name, application_date,
            from_document, from_section, to_document, to_section,
            questions_per_copy, copies, state, created_at, created_by
        ) VALUES (?, 'x', NULL, 'flujo', 'if-else', 'flujo', 'bucles', 4, 3, ?, 0, ?)`,
		"CTRLSTATE00000000000000000", "typoed_state", userID,
	)
	if err == nil {
		t.Fatal("the control table accepted an unknown state, want a CHECK constraint failure")
	}
	if !strings.Contains(err.Error(), "CHECK constraint failed") {
		t.Errorf("rejected with %v, want CHECK constraint failure", err)
	}
}

// Issue #185: the professor opts out of the padded-to-even-pages layout by
// unchecking a form checkbox; the preference persists on the control so a
// future WP-G regenerate honours it. Default = 1 (padded) so every control
// created before the checkbox existed keeps its historical layout, and any
// caller that omits the column (including this test) reads it back as such.
func TestControlDuplexPaddingDefaultsToPaddedWhenTheColumnIsOmitted(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	if _, err := db.ExecContext(ctx, `
        INSERT INTO control (
            id, name, application_date,
            from_document, from_section, to_document, to_section,
            questions_per_copy, copies, state, created_at, created_by
        ) VALUES (?, 'x', NULL, 'flujo', 'if-else', 'flujo', 'bucles', 4, 3, 'generated', 0, ?)`,
		"CTRLPADDING000000000000000", userID,
	); err != nil {
		t.Fatalf("insert without duplex_padding: %v", err)
	}

	var padding int
	err := db.QueryRowContext(ctx,
		`SELECT duplex_padding FROM control WHERE id = ?`,
		"CTRLPADDING000000000000000",
	).Scan(&padding)
	if err != nil {
		t.Fatalf("read back duplex_padding: %v", err)
	}
	if padding != 1 {
		t.Errorf("duplex_padding = %d, want 1 (a control without an explicit preference is duplex-padded, the historical layout)", padding)
	}
}

// Issue #208: the professor picks Letter or A4 in a `<details> Opciones
// avanzadas` block of the create form; the preference persists on the control
// so a future WP-G regenerate honours it. Default = 'letter' so every control
// created before the column existed (and any test insert that omits it) reads
// back as such — the operational default from ADR-0043.
func TestControlPaperDefaultsToLetterWhenTheColumnIsOmitted(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	if _, err := db.ExecContext(ctx, `
        INSERT INTO control (
            id, name, application_date,
            from_document, from_section, to_document, to_section,
            questions_per_copy, copies, state, created_at, created_by
        ) VALUES (?, 'x', NULL, 'flujo', 'if-else', 'flujo', 'bucles', 4, 3, 'generated', 0, ?)`,
		"CTRLPAPER00000000000000000", userID,
	); err != nil {
		t.Fatalf("insert without paper: %v", err)
	}

	var paper string
	err := db.QueryRowContext(ctx,
		`SELECT paper FROM control WHERE id = ?`,
		"CTRLPAPER00000000000000000",
	).Scan(&paper)
	if err != nil {
		t.Fatalf("read back paper: %v", err)
	}
	if paper != "letter" {
		t.Errorf("paper = %q, want %q (a control without an explicit choice is Letter, ADR-0043)", paper, "letter")
	}
}

// Issue #208: only 'letter' and 'a4' are legal; the schema CHECK refuses
// anything else so a caller that invents a third value fails at the write,
// not at the read. Mirrors the duplex_padding CHECK in 00006.
func TestControlPaperCheckRefusesUnknownValue(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	_, err := db.ExecContext(ctx, `
        INSERT INTO control (
            id, name, application_date,
            from_document, from_section, to_document, to_section,
            questions_per_copy, copies, paper, state, created_at, created_by
        ) VALUES (?, 'x', NULL, 'flujo', 'if-else', 'flujo', 'bucles', 4, 3, ?, 'generated', 0, ?)`,
		"CTRLPAPERBAD0000000000000A", "legal", userID,
	)
	if err == nil {
		t.Error("insert with paper = 'legal' accepted; the CHECK constraint should refuse anything outside ('letter','a4')")
	}
}

// Issue #190: the annotated_copy table records where the PDF anotado for one
// copia lives on the shared volume, when it was generated, and which copia it
// belongs to. Nothing about the contents in the DB — path is the whole point.
func TestAnnotatedCopyRoundTripsThePathAndTimestamp(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	if _, err := db.ExecContext(ctx, `
        INSERT INTO control (
            id, name, application_date,
            from_document, from_section, to_document, to_section,
            questions_per_copy, copies, state, created_at, created_by
        ) VALUES (?, 'x', NULL, 'flujo', 'if-else', 'flujo', 'bucles', 4, 3, 'generated', 0, ?)`,
		"CTRLANNOT00000000000000000", userID,
	); err != nil {
		t.Fatalf("insert control: %v", err)
	}

	if _, err := db.ExecContext(ctx, `
        INSERT INTO annotated_copy (control_id, copy_number, generated_at, path)
        VALUES (?, ?, ?, ?)`,
		"CTRLANNOT00000000000000000", 2, int64(1_787_100_000),
		"controls/CTRLANNOT00000000000000000/annotated/copy-2.pdf",
	); err != nil {
		t.Fatalf("insert annotated_copy: %v", err)
	}

	var (
		controlID  string
		copyNumber int
		generated  int64
		path       string
	)
	if err := db.QueryRowContext(ctx,
		`SELECT control_id, copy_number, generated_at, path FROM annotated_copy
         WHERE control_id = ? AND copy_number = ?`,
		"CTRLANNOT00000000000000000", 2,
	).Scan(&controlID, &copyNumber, &generated, &path); err != nil {
		t.Fatalf("read back annotated_copy: %v", err)
	}
	if controlID != "CTRLANNOT00000000000000000" || copyNumber != 2 ||
		generated != 1_787_100_000 ||
		path != "controls/CTRLANNOT00000000000000000/annotated/copy-2.pdf" {
		t.Errorf("round-trip mismatch: control_id=%q copy_number=%d generated_at=%d path=%q",
			controlID, copyNumber, generated, path)
	}

	// The compound PK refuses a duplicate — one annotation per (control, copy).
	// A re-annotation of the same copia replaces via UPSERT elsewhere; a
	// naïve second INSERT is a bug worth reddening.
	_, err := db.ExecContext(ctx, `
        INSERT INTO annotated_copy (control_id, copy_number, generated_at, path)
        VALUES (?, ?, ?, ?)`,
		"CTRLANNOT00000000000000000", 2, int64(1_787_100_001), "otra.pdf",
	)
	if err == nil {
		t.Error("annotated_copy accepted a second INSERT for the same (control, copy), want a UNIQUE / PK conflict")
	}
}

// The one migration case that is about an operator rather than about the schema.
//
// #149 shipped migrations/00001_init.sql, a deliberate `SELECT 1;`, and anyone
// who ran the server locally has a database with version 1 recorded. This WP
// deletes that file. goose keys applied migrations by version, so the new set
// must apply cleanly over a database whose only recorded version no longer
// exists on disk — otherwise the first thing every existing checkout does after
// this PR is fail to boot, and no other test in this suite would see it because
// they all start from an empty file.
func TestTheAuthMigrationAppliesOverADatabaseThatRanThePlaceholder(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nalanda.db")

	// The set as #149 shipped it, reproduced here because the file it names is
	// deleted by this very slice.
	placeholder := fstest.MapFS{
		"00001_init.sql": &fstest.MapFile{Data: []byte(
			"-- +goose Up\nSELECT 1;\n\n-- +goose Down\nSELECT 1;\n",
		)},
	}

	db, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, err := storage.Migrate(ctx, db, placeholder); err != nil {
		t.Fatalf("applying the placeholder set: %v", err)
	}
	_ = db.Close()

	reopened, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatalf("reopening: %v", err)
	}
	defer func() { _ = reopened.Close() }()

	applied, err := storage.Migrate(ctx, reopened, migrations.FS)
	if err != nil {
		t.Fatalf("applying the shipped set over a database that ran the placeholder: %v", err)
	}
	if applied == 0 {
		t.Fatal("the shipped set applied nothing over the placeholder database, so the auth schema never arrived")
	}

	if _, err := reopened.ExecContext(ctx,
		"INSERT INTO users (email, name) VALUES (?, ?)", "profesora@example.com", "Profesora",
	); err != nil {
		t.Errorf("the auth schema is not usable after the upgrade: %v", err)
	}
}

// Issue #197: control.ticked/unsure carry the darkness thresholds end-to-end.
// The defaults are the X-friendly pair chosen from a real batch; a control
// inserted without them inherits the defaults, and an UPDATE round-trips.
func TestControlThresholdsDefaultAndRoundTrip(t *testing.T) {
	ctx, db := migrated(t)
	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	if _, err := db.ExecContext(ctx, `
        INSERT INTO control (
            id, name, from_document, from_section, to_document, to_section,
            questions_per_copy, copies, state, created_at, created_by
        ) VALUES (?, 'x', 'flujo', 'if-else', 'flujo', 'bucles', 4, 3, 'generated', 0, ?)`,
		"CTRLTHRESH0000000000000000", userID,
	); err != nil {
		t.Fatalf("insert control: %v", err)
	}

	var ticked, unsure float64
	if err := db.QueryRowContext(ctx,
		`SELECT ticked, unsure FROM control WHERE id = ?`,
		"CTRLTHRESH0000000000000000",
	).Scan(&ticked, &unsure); err != nil {
		t.Fatalf("read back thresholds: %v", err)
	}
	if ticked != 0.15 || unsure != 0.05 {
		t.Errorf("defaults = (%v, %v), want (0.15, 0.05) — the X-friendly pair of issue #197",
			ticked, unsure)
	}

	if _, err := db.ExecContext(ctx,
		`UPDATE control SET ticked = 0.25, unsure = 0.10 WHERE id = ?`,
		"CTRLTHRESH0000000000000000",
	); err != nil {
		t.Fatalf("update thresholds: %v", err)
	}
	if err := db.QueryRowContext(ctx,
		`SELECT ticked, unsure FROM control WHERE id = ?`,
		"CTRLTHRESH0000000000000000",
	).Scan(&ticked, &unsure); err != nil {
		t.Fatalf("read back updated thresholds: %v", err)
	}
	if ticked != 0.25 || unsure != 0.10 {
		t.Errorf("updated = (%v, %v), want (0.25, 0.10)", ticked, unsure)
	}

	// The per-column CHECKs refuse out-of-band values; the band rule itself
	// (unsure < ticked) is enforced in the domain, not expressible here.
	if _, err := db.ExecContext(ctx,
		`UPDATE control SET ticked = 1.5 WHERE id = ?`,
		"CTRLTHRESH0000000000000000",
	); err == nil {
		t.Error("ticked = 1.5 accepted, want the CHECK to refuse it")
	}
}

// --- The roster schema (issue #271, migration 00014) ----------------------
//
// Same premise as the auth cases above: every rule these tables carry fails
// SILENTLY when it is absent. A missing UNIQUE on student.canvas_user_id
// turns the second import of a course into a second copy of every student;
// a missing cascade leaves an enrollment pointing at a deleted course, and
// WP-2's join then reports a grade for a course that no longer exists.

// insertCourse adds a row to course and returns its id.
func insertCourse(t *testing.T, ctx context.Context, db *sql.DB, code, canvasCourseID string) int64 {
	t.Helper()

	result, err := db.ExecContext(ctx,
		`INSERT INTO course (name, code, term, canvas_course_id) VALUES (?, ?, ?, ?)`,
		"Estructuras de Datos", code, "2026-2", canvasCourseID)
	if err != nil {
		t.Fatalf("inserting the course %s: %v", code, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("reading the inserted course id: %v", err)
	}
	return id
}

// insertStudent adds a row to student and returns its id. rut and rutDV are
// passed as any so a case can hand them nil for "Canvas had no RUT for this
// person" — the two are constrained to be null together.
func insertStudent(t *testing.T, ctx context.Context, db *sql.DB, canvasUserID string, rut, rutDV any) int64 {
	t.Helper()

	result, err := db.ExecContext(ctx,
		`INSERT INTO student (first_name, last_name, email, rut, rut_dv, canvas_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
		"Ana", "Pérez", "ana@example.com", rut, rutDV, canvasUserID)
	if err != nil {
		t.Fatalf("inserting the student %s: %v", canvasUserID, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("reading the inserted student id: %v", err)
	}
	return id
}

func TestTheRosterSchemaAcceptsACourseWithAnEnrolledStudent(t *testing.T) {
	ctx, db := migrated(t)

	courseID := insertCourse(t, ctx, db, "CIT2006-03", "12345")
	studentID := insertStudent(t, ctx, db, "canvas-user-1", "12345678", "5")

	if _, err := db.ExecContext(ctx,
		`INSERT INTO enrollment (course_id, student_id, state, canvas_enrollment_id)
         VALUES (?, ?, ?, ?)`,
		courseID, studentID, "enrolled", "canvas-enr-1",
	); err != nil {
		t.Fatalf("inserting the enrollment: %v", err)
	}

	var (
		name, code, term, canvasCourse  string
		firstName, lastName, rut, rutDV string
		state                           string
	)
	if err := db.QueryRowContext(ctx, `
        SELECT c.name, c.code, c.term, c.canvas_course_id,
               s.first_name, s.last_name, s.rut, s.rut_dv,
               e.state
        FROM enrollment e
        JOIN course  c ON c.id = e.course_id
        JOIN student s ON s.id = e.student_id`,
	).Scan(&name, &code, &term, &canvasCourse, &firstName, &lastName, &rut, &rutDV, &state); err != nil {
		t.Fatalf("reading the roster back: %v", err)
	}
	if code != "CIT2006-03" || term != "2026-2" || canvasCourse != "12345" ||
		firstName != "Ana" || rut != "12345678" || rutDV != "5" || state != "enrolled" {
		t.Errorf("round-trip mismatch: code=%q term=%q canvas=%q first=%q rut=%q rut_dv=%q state=%q",
			code, term, canvasCourse, firstName, rut, rutDV, state)
	}
}

// The RUT is the join key WP-2 matches readings against, so two students
// cannot share one. Three rules, all measured against real Canvas data in
// the S4 spike (ADR-0069):
//
//   - the body is exactly eight digits, because that is what
//     \AMCcode{rut}{8} prints and therefore what a reading can hold;
//   - the verifier is a digit or K, and travels with the body or not at all;
//   - both may be NULL together, and NULLs do not collide under the UNIQUE,
//     so one student Canvas has no RUT for costs one unmatchable row rather
//     than the rest of the import.
func TestStudentRutIsUniqueWhenPresentAndAbsentRutsDoNotCollide(t *testing.T) {
	ctx, db := migrated(t)

	insertStudent(t, ctx, db, "canvas-user-1", "12345678", "5")

	if _, err := db.ExecContext(ctx,
		`INSERT INTO student (first_name, last_name, email, rut, rut_dv, canvas_user_id)
         VALUES ('Otra', 'Persona', 'otra@example.com', '12345678', '5', 'canvas-user-2')`,
	); err == nil {
		t.Error("a second student with the same RUT was accepted, want a UNIQUE conflict")
	}

	insertStudent(t, ctx, db, "canvas-user-3", nil, nil)
	if _, err := db.ExecContext(ctx,
		`INSERT INTO student (first_name, last_name, email, rut, rut_dv, canvas_user_id)
         VALUES ('Sin', 'Rut', 'sinrut@example.com', NULL, NULL, 'canvas-user-4')`,
	); err != nil {
		t.Errorf("a second student without a RUT was refused (%v); NULLs must not collide", err)
	}
}

// The shape of the two columns, refused at the schema rather than trusted to
// the importer. Each of these is a row that would look like data and join
// against nothing.
func TestStudentRutRefusesEveryShapeAReadingCouldNotMatch(t *testing.T) {
	ctx, db := migrated(t)

	for _, c := range []struct {
		name  string
		rut   any
		rutDV any
	}{
		{"an empty body", "", "5"},
		{"seven digits, unpadded — the sheet prints eight", "1234567", "5"},
		{"nine digits — the verifier left on the body", "123456785", "5"},
		{"a body with the verifier's K in it", "1234567K", "5"},
		{"a body that is not digits", "1234-567", "5"},
		{"a lowercase verifier", "12345678", "k"},
		{"a two-character verifier", "12345678", "5K"},
		{"a body with no verifier", "12345678", nil},
		{"a verifier with no body", nil, "5"},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := db.ExecContext(ctx,
				`INSERT INTO student (first_name, last_name, email, rut, rut_dv, canvas_user_id)
                 VALUES ('X', 'Y', 'x@example.com', ?, ?, ?)`,
				c.rut, c.rutDV, "canvas-"+c.name)
			if err == nil {
				t.Fatal("the row was accepted, want a CHECK constraint failure")
			}
			// Naming the constraint matters, for the same reason the
			// foreign-key case above does it: rejected-for-another-reason
			// is how a guard goes green while verifying nothing. Every row
			// here carries a distinct canvas_user_id precisely so a UNIQUE
			// violation cannot stand in for the CHECK.
			if !strings.Contains(err.Error(), "CHECK") {
				t.Errorf("rejected with %v, want a CHECK constraint failure", err)
			}
		})
	}
}

// K is a real verifier, not a theoretical branch: four of the twenty-five
// students on the course measured in S4 had one.
func TestStudentRutAcceptsAVerifierOfK(t *testing.T) {
	ctx, db := migrated(t)

	insertStudent(t, ctx, db, "canvas-user-k", "11222444", "K")

	var rut, dv string
	if err := db.QueryRowContext(ctx,
		`SELECT rut, rut_dv FROM student WHERE canvas_user_id = ?`, "canvas-user-k",
	).Scan(&rut, &dv); err != nil {
		t.Fatalf("reading the K-verifier student back: %v", err)
	}
	if rut != "11222444" || dv != "K" {
		t.Errorf("round-trip = %q/%q, want 11222444/K", rut, dv)
	}
}

// The upsert key of the import (S6). Without this UNIQUE a re-import adds a
// second row for every person whose RUT Canvas does not carry — the exact
// case the nullable RUT above makes possible.
func TestStudentCanvasUserIDIsUnique(t *testing.T) {
	ctx, db := migrated(t)

	insertStudent(t, ctx, db, "canvas-user-1", "12345678", "5")

	if _, err := db.ExecContext(ctx,
		`INSERT INTO student (first_name, last_name, email, rut, rut_dv, canvas_user_id)
         VALUES ('Otra', 'Persona', 'otra@example.com', '87654321', '9', 'canvas-user-1')`,
	); err == nil {
		t.Error("a second student with the same canvas_user_id was accepted, want a UNIQUE conflict")
	}
}

// One Nalanda course per Canvas course. The picker (S5) refuses to offer a
// course twice, and this is the schema-level belt behind that policy.
func TestCourseCanvasCourseIDIsUnique(t *testing.T) {
	ctx, db := migrated(t)

	insertCourse(t, ctx, db, "CIT2006-03", "12345")

	if _, err := db.ExecContext(ctx,
		`INSERT INTO course (name, code, term, canvas_course_id)
         VALUES ('Otro nombre', 'CIT2006-04', '2026-2', '12345')`,
	); err == nil {
		t.Error("a second course with the same canvas_course_id was accepted, want a UNIQUE conflict")
	}
}

func TestEnrollmentIsUniquePerCourseAndStudent(t *testing.T) {
	ctx, db := migrated(t)

	courseID := insertCourse(t, ctx, db, "CIT2006-03", "12345")
	studentID := insertStudent(t, ctx, db, "canvas-user-1", "12345678", "5")

	if _, err := db.ExecContext(ctx,
		`INSERT INTO enrollment (course_id, student_id, state) VALUES (?, ?, 'enrolled')`,
		courseID, studentID,
	); err != nil {
		t.Fatalf("inserting the enrollment: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO enrollment (course_id, student_id, state) VALUES (?, ?, 'withdrawn')`,
		courseID, studentID,
	); err == nil {
		t.Error("a second enrollment for the same (course, student) was accepted, want a UNIQUE conflict")
	}
}

// The two states are exhaustive by design (issue #271 §Entities); the CHECK
// is what keeps a typo in a future writer from inventing a third.
func TestEnrollmentStateRefusesAnUnknownValue(t *testing.T) {
	ctx, db := migrated(t)

	courseID := insertCourse(t, ctx, db, "CIT2006-03", "12345")
	studentID := insertStudent(t, ctx, db, "canvas-user-1", "12345678", "5")

	if _, err := db.ExecContext(ctx,
		`INSERT INTO enrollment (course_id, student_id, state) VALUES (?, ?, 'retirado')`,
		courseID, studentID,
	); err == nil {
		t.Error("state = 'retirado' was accepted, want the CHECK to refuse it")
	}
}

func TestTheRosterSchemaEnforcesItsReferences(t *testing.T) {
	ctx, db := migrated(t)

	courseID := insertCourse(t, ctx, db, "CIT2006-03", "12345")
	studentID := insertStudent(t, ctx, db, "canvas-user-1", "12345678", "5")

	for _, c := range []struct {
		name  string
		query string
		args  []any
	}{
		{
			name:  "enrollment in an unknown course",
			query: `INSERT INTO enrollment (course_id, student_id, state) VALUES (?, ?, 'enrolled')`,
			args:  []any{int64(4242), studentID},
		},
		{
			name:  "enrollment of an unknown student",
			query: `INSERT INTO enrollment (course_id, student_id, state) VALUES (?, ?, 'enrolled')`,
			args:  []any{courseID, int64(4242)},
		},
		{
			name:  "secret of an unknown professor",
			query: `INSERT INTO user_secrets (user_id, namespace, key, ciphertext) VALUES (?, ?, ?, ?)`,
			args:  []any{int64(4242), "canvas", "token", []byte("blob")},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := db.ExecContext(ctx, c.query, c.args...)
			if err == nil {
				t.Fatal("the row was accepted, want a foreign-key error")
			}
			// Naming the constraint matters: before the schema existed, this
			// case passed on "no such table" — an error for the wrong reason
			// is how a guard goes green while verifying nothing.
			if !strings.Contains(err.Error(), "FOREIGN KEY") {
				t.Errorf("rejected with %v, want a FOREIGN KEY constraint failure", err)
			}
		})
	}
}

// Deleting a course takes its enrollments and LEAVES the students: a person
// is not a member of one course (§Entities, "a student is one person"), and
// cascading through the join to the person would delete someone still
// enrolled elsewhere.
func TestDeletingACourseRemovesItsEnrollmentsAndLeavesTheStudent(t *testing.T) {
	ctx, db := migrated(t)

	courseID := insertCourse(t, ctx, db, "CIT2006-03", "12345")
	studentID := insertStudent(t, ctx, db, "canvas-user-1", "12345678", "5")
	if _, err := db.ExecContext(ctx,
		`INSERT INTO enrollment (course_id, student_id, state) VALUES (?, ?, 'enrolled')`,
		courseID, studentID,
	); err != nil {
		t.Fatalf("inserting the enrollment: %v", err)
	}

	if _, err := db.ExecContext(ctx, `DELETE FROM course WHERE id = ?`, courseID); err != nil {
		t.Fatalf("deleting the course: %v", err)
	}

	var enrollments, students int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM enrollment`).Scan(&enrollments); err != nil {
		t.Fatalf("counting enrollments: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM student`).Scan(&students); err != nil {
		t.Fatalf("counting students: %v", err)
	}
	if enrollments != 0 {
		t.Errorf("enrollment still holds %d row(s) after the course was deleted, want 0", enrollments)
	}
	if students != 1 {
		t.Errorf("student holds %d row(s) after the course was deleted, want the person to survive", students)
	}
}

// One ciphertext per (professor, namespace, key) — the triple the AAD binds
// in S2. The cascade matters because a deleted professor's encrypted Canvas
// token has no owner left to decrypt it.
func TestUserSecretsIsUniquePerTripleAndCascadesWithTheProfessor(t *testing.T) {
	ctx, db := migrated(t)

	userID := insertProfessor(t, ctx, db, "profesora@example.com")

	if _, err := db.ExecContext(ctx,
		`INSERT INTO user_secrets (user_id, namespace, key, ciphertext) VALUES (?, ?, ?, ?)`,
		userID, "canvas", "token", []byte("sealed"),
	); err != nil {
		t.Fatalf("inserting the secret: %v", err)
	}

	// A different key under the same namespace is a different row.
	if _, err := db.ExecContext(ctx,
		`INSERT INTO user_secrets (user_id, namespace, key, ciphertext) VALUES (?, ?, ?, ?)`,
		userID, "canvas", "refresh", []byte("sealed-2"),
	); err != nil {
		t.Errorf("a second key under the same namespace was refused: %v", err)
	}

	if _, err := db.ExecContext(ctx,
		`INSERT INTO user_secrets (user_id, namespace, key, ciphertext) VALUES (?, ?, ?, ?)`,
		userID, "canvas", "token", []byte("otro"),
	); err == nil {
		t.Error("a second secret for the same (user, namespace, key) was accepted, want a UNIQUE conflict")
	}

	// The blob round-trips as bytes, not as text: a BLOB column that silently
	// became TEXT would corrupt every ciphertext at the first non-UTF-8 byte.
	sealed := []byte{0x00, 0xff, 0x10, 0x80}
	if _, err := db.ExecContext(ctx,
		`UPDATE user_secrets SET ciphertext = ? WHERE user_id = ? AND namespace = ? AND key = ?`,
		sealed, userID, "canvas", "token",
	); err != nil {
		t.Fatalf("updating the ciphertext: %v", err)
	}
	var back []byte
	if err := db.QueryRowContext(ctx,
		`SELECT ciphertext FROM user_secrets WHERE user_id = ? AND namespace = ? AND key = ?`,
		userID, "canvas", "token",
	).Scan(&back); err != nil {
		t.Fatalf("reading the ciphertext back: %v", err)
	}
	if !bytes.Equal(back, sealed) {
		t.Errorf("ciphertext round-tripped as %v, want %v", back, sealed)
	}

	if _, err := db.ExecContext(ctx, `DELETE FROM users WHERE user_id = ?`, userID); err != nil {
		t.Fatalf("deleting the professor: %v", err)
	}
	var rows int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM user_secrets`).Scan(&rows); err != nil {
		t.Fatalf("counting user_secrets: %v", err)
	}
	if rows != 0 {
		t.Errorf("user_secrets still holds %d row(s) after the professor was deleted, want 0", rows)
	}
}
