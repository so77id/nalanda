-- Grow `users` with the column that answers "is this account still in use, or
-- did I create it a semester ago for someone who never came back". Written by
-- the login path in the same WP.
--
-- Cannot be read from user_sessions.last_seen_at: that row is DELETED on
-- logout, so the professor who signs out tidily is exactly the one whose last
-- sign-in would render blank. A displayed value that is wrong for well-behaved
-- users is worse than no column (issue #151 §Last sign-in).
--
-- Nullable: a professor created by the CRUD and not yet arrived has never
-- logged in, and the list says so in words rather than showing an epoch.
--
-- Numbered 00003, not 00002 or a reused number. goose keys applied migrations
-- by VERSION and reusing a number would be silently skipped by every checkout
-- that has already run the earlier one (see 00002_auth.sql for the earlier
-- version of the same scar).

-- +goose Up

ALTER TABLE users ADD COLUMN last_login_at INTEGER;

-- +goose Down

-- Documentation of the inverse, never executed: rolling a binary back over an
-- applied migration is not supported (ADR-0034 §Consequences,
-- backend-code-style.md §Adding a migration, rule 2).
ALTER TABLE users DROP COLUMN last_login_at;
