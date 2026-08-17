-- The entrance-controls tables (issue #166, WP-E) — one control is a printed
-- quiz that draws its pool from the published question bank (ADR-0032) and is
-- read back by the AMC worker (ADR-0030). Three tables:
--
--   control            one row per generated control
--   control_pregunta   the pool it drew from, in the order it was drawn
--   copia              one row per printed sheet identity
--
-- V1 has one implicit course, so no curso_id column: WP-D adds it. Fields
-- mirror docs/design/2026-08-controles.md §Data model minus curso_id and plus
-- what the domain needs (id as ULID-shape text, created_by as
-- users(user_id) for audit).
--
-- Numbered 00004 rather than 00003 (deleted or otherwise). goose keys applied
-- migrations by version, so a reused number is silently skipped by every
-- checkout that already ran the earlier one — 00003_last_login_at.sql carries
-- the earlier version of this scar.
--
-- Times are unix seconds in INTEGER columns, matching the existing tables and
-- what SQLite's unixepoch() returns. Nullable application_date carries "no
-- date declared" from the form's optional field.

-- +goose Up

CREATE TABLE control (
    -- 26-character base32 identifier (controls.NewID); the URL segment, and
    -- printed on every copy. TEXT PRIMARY KEY because a random string cannot
    -- share INTEGER PRIMARY KEY's rowid semantics — and using AUTOINCREMENT
    -- here would leak "the 34th control we ever made" to a reader of the URL.
    id                 TEXT    PRIMARY KEY NOT NULL,
    name               TEXT    NOT NULL,
    -- unix seconds. NULL is "no date declared", which the form allows so a
    -- draft control can be generated before its class is scheduled. The list
    -- orders these last, since a control without a date does not have a
    -- reading position in the calendar.
    application_date   INTEGER,
    from_document      TEXT    NOT NULL,
    from_section       TEXT    NOT NULL,
    to_document        TEXT    NOT NULL,
    to_section         TEXT    NOT NULL,
    questions_per_copy INTEGER NOT NULL CHECK (questions_per_copy > 0),
    copies             INTEGER NOT NULL CHECK (copies > 0),
    -- CHECK-guarded rather than a lookup table: the three values are
    -- exhaustive by design (§Data model), and a lookup would only be a place
    -- to write the same three values a second time.
    state              TEXT    NOT NULL CHECK (state IN ('generated', 'in_review', 'graded')),
    created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
    -- Audit column: which professor generated this. ON DELETE RESTRICT
    -- rather than CASCADE — deleting a professor with generated controls is
    -- data loss (grades hang off them, WP-F), and the debt of
    -- deactivate-vs-delete is deferred to WP-D anyway. RESTRICT names it.
    created_by         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT
);

-- Sorting the list is the most common read shape, and the compound index
-- covers it: application_date DESC first for the primary order, created_at
-- DESC as the tie-breaker so two controls scheduled the same day surface in
-- creation order.
CREATE INDEX idx_control_by_application_date ON control (application_date DESC, created_at DESC);

CREATE TABLE control_pregunta (
    control_id   TEXT    NOT NULL REFERENCES control(id) ON DELETE CASCADE,
    -- The authored id from the bank (ADR-0032). Not a foreign key here: the
    -- bank is a JSON artifact read from apps/web, not a table. The Service
    -- resolves the ref against the loaded bank at read time.
    pregunta_ref TEXT    NOT NULL,
    -- 0-based position in the drawn pool.
    orden        INTEGER NOT NULL,
    PRIMARY KEY (control_id, pregunta_ref)
);
CREATE INDEX idx_control_pregunta_by_control_order ON control_pregunta (control_id, orden);

CREATE TABLE copia (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    control_id TEXT    NOT NULL REFERENCES control(id) ON DELETE CASCADE,
    -- 1-based, matches AMC's printed \onecopy index.
    numero     INTEGER NOT NULL CHECK (numero > 0),
    UNIQUE (control_id, numero)
);
CREATE INDEX idx_copia_by_control ON copia (control_id);

-- +goose Down

-- Documentation of the inverse, never executed (ADR-0034 §Consequences,
-- backend-code-style.md §Adding a migration).
DROP TABLE copia;
DROP TABLE control_pregunta;
DROP TABLE control;
