-- Issue #197: one darkness-threshold pair per control, travelling end-to-end.
--
--   ticked  at or above this black/total ratio a box counts as a confident mark
--   unsure  at or above this ratio (below ticked) a box is reported as doubtful
--
-- One pair PER CONTROL, last-wins: the upload form can set it, the reanalyse
-- form re-sets it, and the worker uses the SAME ticked for the reader, for
-- AMC's `note` and for the annotated PDF — marks, scores and the drawn sheet
-- agree on one threshold (the report's scoring.stale can no longer be produced
-- by the server flow).
--
-- Defaults 0.15/0.05, measured on a real batch (Jetson 2026-08-19): pencil X
-- marks read 0.14-0.32 darkness, painted squares 0.62-1.00, empty boxes ~0.0.
-- The previous hardcoded default 0.30 cut straight through the X band. Rows
-- from before the migration inherit the new defaults, which is exactly what
-- their next re-read should use.
--
-- The band rule (0 <= unsure < ticked < 1) cannot be expressed as column
-- CHECKs — it spans two columns — so the SQL level guards each bound alone
-- and the domain validates the pair (controls.Service, like the worker's
-- parse_thresholds).

-- +goose Up
ALTER TABLE control
    ADD COLUMN ticked REAL NOT NULL DEFAULT 0.15 CHECK (ticked > 0 AND ticked < 1);
ALTER TABLE control
    ADD COLUMN unsure REAL NOT NULL DEFAULT 0.05 CHECK (unsure >= 0 AND unsure < 1);

-- +goose Down
ALTER TABLE control DROP COLUMN unsure;
ALTER TABLE control DROP COLUMN ticked;
