-- Issue #272 S8: the index the student page's query needs.
--
-- Migration 00015 deliberately added NO index, and said why: an index
-- belongs in the slice whose EXPLAIN QUERY PLAN can attribute it, because
-- "an index justified by a query the plan disowns is an index somebody
-- drops later after checking the stated reason and finding it false"
-- (00014's own comment, from #271 review PER-4). S8 is that slice, and
-- this is that measurement.
--
-- THE READER is controlstore.CopiesForStudent:
--
--     SELECT reading.control_id, reading.copy_number
--     FROM reading
--     JOIN control ON control.id = reading.control_id
--     WHERE reading.student_id = ?
--       AND control.deleted_at IS NULL
--     ORDER BY control.application_date IS NULL,
--              control.application_date DESC, control.created_at DESC
--
-- MEASURED, on the shipped schema, 2026-09-07:
--
--   without this index
--     SEARCH control USING INDEX idx_control_deleted_at (deleted_at=?)
--     SEARCH reading USING INDEX idx_reading_by_control (control_id=?)
--     USE TEMP B-TREE FOR ORDER BY
--
--   with it
--     SEARCH reading USING INDEX idx_reading_by_student (student_id=?)
--     SEARCH control USING INDEX sqlite_autoindex_control_1 (id=?)
--     USE TEMP B-TREE FOR ORDER BY
--
-- The difference is which table the plan DRIVES FROM. Without the index
-- it enters at `control`, walks every active one, and probes that
-- control's readings — so asking for one person's copies reads every
-- copy of every control, and the cost grows with the whole history of the
-- course rather than with the handful of controls that person sat. With
-- it, the plan enters at `reading` on exactly the rows that name them.
--
-- The temp B-tree survives either way: the ORDER BY is over `control`
-- columns while the driving table is `reading`, so no single index can
-- cover it. Saying so here is the point — the next reader should not
-- discover it and assume the index is not working.
--
-- Numbered 00016, after 00015_matching.sql. Numbers are never reused,
-- even deleted ones — the scar is written out in 00002_auth.sql.

-- +goose Up

-- Nullable column, and that is fine: SQLite indexes NULLs, and the
-- lookups are all `student_id = ?` for a real id. The unmatched rows sit
-- in the index under NULL and are never probed for.
CREATE INDEX idx_reading_by_student ON reading (student_id);

-- +goose Down

-- Documentation of the inverse, never executed: ADR-0034 §Consequences
-- records that rolling a binary back over an applied migration is not
-- supported (backend-code-style.md §Adding a migration, rule 2).
DROP INDEX idx_reading_by_student;
