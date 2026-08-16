-- Deliberately empty, and it has to exist.
--
-- Issue #149 §Non-goals: this WP creates no domain tables. Courses, students
-- and enrolment are WP-D; users and sessions are WP-C2. The only schema the
-- skeleton is entitled to create is goose's own version table.
--
-- So why a file at all? Two reasons, and neither is ceremony:
--
--   1. `//go:embed *.sql` does not compile over a directory with no .sql in it,
--      and repository-structure.md §Principles forbids a .gitkeep placeholder.
--      A migration that says why it is empty is better than a directory that
--      cannot explain itself.
--   2. It makes the migration path provable. With zero migrations, "the second
--      boot changed nothing" is true of an implementation that never runs goose
--      at all. With this one, goose records version 1 on the first boot and
--      applies nothing on the second — which is what AC-4 asks for and what the
--      non-vacuity guard in sqlite_test.go asserts.
--
-- The first real migration is WP-C2's users table. Delete this file then, in
-- the same PR, and the guard above keeps the suite honest.

-- +goose Up
SELECT 1;

-- +goose Down
SELECT 1;
