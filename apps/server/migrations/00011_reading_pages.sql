-- Issue #243: persist which pages of each copy AMC captured.
--
-- The review page's raw-scan fallback (issue #190) renders one <img>
-- per captured page, and until this WP it only asked for page 1 — a
-- two-page copy lost half its answers to the professor. AMC is the
-- source of truth: read_capture.py now emits `pages_per_copy` (S1),
-- and this column stores that per-copy list so the review template
-- can iterate it.
--
-- Shape: a JSON array of ascending 1-based page numbers, mirroring
-- what the worker sends on the wire. Same "JSON array in a TEXT
-- column" pattern as answer.marked_json (00005) and
-- answer.alternatives_json (00010) — the natural read shape is
-- "here is the whole list at once" and a normalised child table
-- would answer every review render with an extra query per copy.
--
-- Two-step so legacy readings (persisted before this WP, when the
-- fallback rendered only page 1) end up with '[1]' rather than an
-- empty list. The ALTER's DEFAULT '[]' backfills every existing row
-- to '[]' as a side-effect of adding the NOT NULL column; the UPDATE
-- turns those specific rows into '[1]' so the fallback the review
-- page will iterate on legacy data is the SAME page 1 it used to
-- render on its own. The WHERE clause is scoped to the placeholder
-- so a hypothetical INSERT that raced this migration with an
-- explicit '[]' payload is not clobbered — a new writer always sets
-- pages_json from ReportCopy.Pages, so the DEFAULT is only ever the
-- ALTER's transient value on existing rows.

-- +goose Up
ALTER TABLE reading ADD COLUMN pages_json TEXT NOT NULL DEFAULT '[]';
UPDATE reading SET pages_json = '[1]' WHERE pages_json = '[]';

-- +goose Down
ALTER TABLE reading DROP COLUMN pages_json;
