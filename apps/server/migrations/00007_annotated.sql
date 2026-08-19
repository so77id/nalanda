-- Issue #190: each copia ends the ciclo del control with an annotated PDF
-- (marks on the sheet, correct answers, per-question score) — either produced
-- automatically after `/analyse` for `status:ok` copias, or after each manual
-- save on the review page for `needs_review` ones. The two paths converge on
-- one row per copia in this table. The PDF itself lives on the shared volume
-- at `path`; nothing about its bytes is stored in the DB.
--
-- Numbered 00007 rather than 00006 (which is duplex_padding, #185). Migration
-- numbers are never reused — see the scar in 00003_last_login_at.sql for why.
--
-- Compound PK (control_id, copy_number) — one annotation per copia. A
-- re-annotation replaces via UPSERT (INSERT ... ON CONFLICT), so re-editing
-- an override in the review page produces a fresh anotado without leaving
-- the previous row around. The compound is also the query shape the review
-- page hits: "does this copia have an anotado?" is a single-row lookup.
--
-- ON DELETE CASCADE keeps this table honest — if a control disappears, so do
-- its annotated rows. Matches how `reading` / `copia` are wired.

-- +goose Up
CREATE TABLE annotated_copy (
    control_id    TEXT    NOT NULL REFERENCES control(id) ON DELETE CASCADE,
    copy_number   INTEGER NOT NULL CHECK (copy_number > 0),
    -- unix seconds, when the annotate job finished writing `path`. Handy for
    -- the review page to show "última anotación: hace 3 minutos" and for
    -- diagnostics ("was this annotation stale before Cerrar corrección?").
    generated_at  INTEGER NOT NULL,
    -- Path on the shared /work volume, RELATIVE to WorkDir. Absolute on the
    -- worker side is `<WorkerWorkDir>/<path>`; the server resolves the host
    -- side with `filepath.Join(WorkDir, path)`. Same convention as
    -- `sujet.pdf` and the scan images.
    path          TEXT    NOT NULL,
    PRIMARY KEY (control_id, copy_number)
);

-- +goose Down
DROP TABLE annotated_copy;
