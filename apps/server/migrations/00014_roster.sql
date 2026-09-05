-- Issue #271 (WP-1 of epic #270): the student roster and the professor's
-- encrypted Canvas token. Four tables:
--
--   course        one row per course the professor teaches
--   student       one row per PERSON, shared across courses
--   enrollment    the join, carrying enrolled | withdrawn
--   user_secrets  per-professor encrypted secrets (the Canvas token, S2)
--
-- `course` is CREATED here, not extended: 00004_controls.sql says in its own
-- header that "V1 has one implicit course, so no curso_id column: WP-D adds
-- it", and WP-D is this WP. Linking `control` to a course is NOT part of it —
-- the control flow is untouched (#271 §Non-goals) and the column arrives with
-- the WP that has a reader for it.
--
-- Numbered 00014, after 00013_control_deleted_at.sql. Numbers are never
-- reused, even deleted ones — the scar is written out in 00002_auth.sql.
--
-- Times are unix seconds in INTEGER columns, like every other table here, and
-- what SQLite's unixepoch() returns.
--
-- Identifiers are English (root CLAUDE.md). The issue body spelled the
-- columns `nombre` / `apellido` / `correo`; `users(email, name)` next door is
-- already English and Spanish belongs to what a person reads, not to a column
-- name. The Spanish table names in 00004 (`control_pregunta`, `copia`) are
-- inherited from docs/design/2026-08-controles.md §Data model and are not a
-- precedent this migration extends.

-- +goose Up

-- INTEGER PRIMARY KEY AUTOINCREMENT, unlike `control`'s 26-character random
-- TEXT id. `control` is opaque because it is PRINTED on every copy, where a
-- sequential number would tell a student how many controls this course has
-- ever run. A course id is only ever seen inside /courses/{id}, which sits
-- behind RequireProfessor — there is no anonymous reader to hide a count
-- from, and an opaque id here would need a second copy of controls.NewID in
-- a second domain to earn nothing.
CREATE TABLE course (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    -- What Canvas calls the course. Both come from Canvas at creation time
    -- (the picker in S5), never typed by a human.
    name             TEXT    NOT NULL,
    -- The section code, e.g. 'CIT2006-03'.
    code             TEXT    NOT NULL,
    -- The academic period, e.g. '2026-2'.
    term             TEXT    NOT NULL,
    -- TEXT, not INTEGER: Canvas's GraphQL surface hands out opaque Relay
    -- global ids and its REST surface a number, and nothing on this side
    -- ever does arithmetic on either. Storing the identifier as text means
    -- the client can change which one it reads without a migration.
    --
    -- UNIQUE so one Canvas course maps to exactly one Nalanda course. The
    -- picker refuses to offer an already-added course; this is the belt
    -- behind that policy, and what makes a double-submit of the form a
    -- refused INSERT rather than a duplicate roster.
    canvas_course_id TEXT    NOT NULL UNIQUE,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

-- A student is a PERSON, not a membership: two courses in the same term
-- share one row here and differ only in `enrollment`. That is what makes
-- WP-2's "todas las notas de este alumno" a single query.
CREATE TABLE student (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name     TEXT    NOT NULL,
    last_name      TEXT    NOT NULL,
    -- COLLATE NOCASE for the same reason users.email is (00002_auth.sql):
    -- the address arrives as its owner typed it. NOT unique — the roster is
    -- Canvas's, and refusing an import because two rows share a shared
    -- address would fail the whole class over one person's data.
    email          TEXT    NOT NULL DEFAULT '' COLLATE NOCASE,
    -- The RUT, SPLIT: `rut` is the 8-digit body and `rut_dv` the verifier.
    --
    -- The split is what the S4 spike found, measured against the real UDP
    -- Canvas (ADR-0069). Canvas puts the RUT in `user.sisId` WITH its
    -- verifier and no separators — `112223335`, `11222444K` — while the
    -- printed sheet reads `\AMCcode{rut}{8}`, eight digits and no verifier.
    -- So the body is the only part that can join `reading.rut_read`, and
    -- the verifier is the part a person needs to see a RUT written
    -- correctly. Keeping both costs one column; dropping the verifier now
    -- would cost a migration and a re-import the first time WP-3 puts a
    -- RUT in an email.
    --
    -- Exactly eight digits, enforced by GLOB rather than left to the
    -- importer. A seven-digit RUT reaches the sheet zero-padded, because
    -- AMC's code field is fixed-width — so a row storing `9876543` could
    -- never match the `09876543` a reading holds, and would be an
    -- unmatchable student nobody could explain. The CHECK makes the
    -- normaliser pad instead of the join silently missing.
    --
    -- NULLABLE, and that is deliberate. Canvas may hold no RUT for a
    -- person: 25 of 25 had one on the course measured in S4, which is
    -- evidence and not a guarantee. SQLite lets any number of NULLs
    -- coexist under a UNIQUE, so an unknown RUT costs exactly one
    -- unmatchable student instead of failing the import of everyone after
    -- the first. The GLOB also refuses the empty string, which would
    -- otherwise become the "unknown" value that DOES collide.
    rut            TEXT    UNIQUE
                       CHECK (rut IS NULL OR rut GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    -- The verifier: a digit, or K. Uppercase — the normaliser folds it, so
    -- the CHECK does not have to accept both cases and the column cannot
    -- hold two spellings of one RUT. Four of the 25 students measured in
    -- S4 had K, so this is not a theoretical branch.
    rut_dv         TEXT    CHECK (rut_dv IS NULL OR rut_dv GLOB '[0-9K]'),
    -- The import's upsert key, which is why it is UNIQUE and NOT NULL: with
    -- a nullable RUT above, `rut` alone cannot identify a returning person,
    -- and a re-import would add a second row for everyone Canvas has no RUT
    -- for. Same TEXT-not-INTEGER reasoning as course.canvas_course_id.
    canvas_user_id TEXT    NOT NULL UNIQUE,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    -- The two halves travel together or not at all. A body without its
    -- verifier is a RUT nothing can render, and a verifier without a body
    -- is a row the join can never reach — both are half-records that would
    -- read as data.
    CHECK ((rut IS NULL) = (rut_dv IS NULL))
);

CREATE TABLE enrollment (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id            INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    -- ON DELETE CASCADE from the person too: a student row that goes away
    -- takes its memberships with it. Note the asymmetry with the reverse
    -- direction — deleting a COURSE deletes enrollments and leaves the
    -- people, because a person is not a member of one course. Pinned by
    -- TestDeletingACourseRemovesItsEnrollmentsAndLeavesTheStudent.
    student_id           INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    -- CHECK-guarded rather than a lookup table, like control.state in 00004:
    -- the two values are exhaustive by design (#271 §Entities) and a lookup
    -- would only be a second place to write them. `withdrawn` is what a
    -- re-import stamps on someone Canvas no longer lists — the row is never
    -- deleted, because their grades hang off the RUT match in WP-2.
    state                TEXT    NOT NULL CHECK (state IN ('enrolled', 'withdrawn')),
    -- Nullable: Canvas's enrollment id is carried for traceability, and a
    -- roster row that reaches us without one is still a real enrolment.
    canvas_enrollment_id TEXT,
    enrolled_at          INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
    -- The upsert key of the import: one membership per (course, person).
    UNIQUE (course_id, student_id)
);

-- The roster page's read shape is "the people in this course, enrolled
-- first" — (course_id, state) covers it.
CREATE INDEX idx_enrollment_by_course ON enrollment (course_id, state);

-- Per-professor secrets at rest, encrypted with AES-256-GCM by
-- internal/domain/secret (S2). Transplanted from DocumentBuddy's table of
-- the same name (its ADR-012); the Nalanda ADR filed in S2 records the
-- transplant and what was changed on entry.
CREATE TABLE user_secrets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    -- The provider this secret belongs to, e.g. 'canvas'. Kept separate from
    -- `key` so a provider with two secrets (a token and a refresh token) is
    -- two rows under one namespace rather than two conventions in one string.
    namespace  TEXT    NOT NULL,
    key        TEXT    NOT NULL,
    -- BLOB, never TEXT: the sealed layout is nonce(12) || ciphertext ||
    -- tag(16), arbitrary bytes with no encoding. A TEXT column would corrupt
    -- every ciphertext at its first non-UTF-8 byte, and SQLite would not say
    -- so. Pinned by the byte round-trip in
    -- TestUserSecretsIsUniquePerTripleAndCascadesWithTheProfessor.
    ciphertext BLOB    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    -- The triple the AAD binds each ciphertext to (S2). Also the conflict
    -- target of the store's upsert.
    UNIQUE (user_id, namespace, key)
);

-- +goose Down

-- Documentation of the inverse, never executed: ADR-0034 §Consequences
-- records that rolling a binary back over an applied migration is not
-- supported (backend-code-style.md §Adding a migration, rule 2).
DROP TABLE user_secrets;
DROP INDEX idx_enrollment_by_course;
DROP TABLE enrollment;
DROP TABLE student;
DROP TABLE course;
