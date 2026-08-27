-- Issue #261: soft-delete for controls.
--
-- A control today can only be removed by SSHing into the host and running
-- DELETE against the SQLite file (issue #261 Problem section) — untenable
-- once the professor is generating test controls in production. The endpoint
-- shape is a two-step Archive → Purge:
--
--   Archive is a soft delete: `deleted_at` receives the current unix seconds
--   and the row disappears from `/controls`. `/controls/archived` still sees
--   it, and Restore clears the column.
--
--   Purge is the hard delete, and the schema-level guard is that it only
--   fires on rows with `deleted_at IS NOT NULL` (see controlstore.PurgeControl,
--   which encodes the same guard in its WHERE clause). ADR-0034 §Consequences
--   already left the FKs on control's dependents as ON DELETE CASCADE for
--   exactly this eventuality — the DELETE reaches every row in
--   control_pregunta, copia, reading, answer, annotated_copy, job.
--
-- Shape: nullable INTEGER (unix seconds), same convention as `created_at`,
-- `application_date`, and every other time in this schema. NULL = active,
-- non-NULL = archived at that instant. The Down drops the index BEFORE the
-- column — SQLite implicitly drops indexes on a dropped column, but making
-- the order explicit here keeps the rollback readable for the operator.
--
-- The index covers `WHERE deleted_at IS NULL` on `ListControls` — miles of
-- rows in the future once several courses are on the Jetson. Skipping it
-- would still work with today's row counts and would silently regress once
-- the list grows.

-- +goose Up
ALTER TABLE control ADD COLUMN deleted_at INTEGER;
CREATE INDEX idx_control_deleted_at ON control (deleted_at);

-- +goose Down
DROP INDEX idx_control_deleted_at;
ALTER TABLE control DROP COLUMN deleted_at;
