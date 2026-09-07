-- Issue #273 (WP-3 of epic #270): publishing a corrected control and
-- emailing the annotated PDFs. Four schema changes, three of them one line
-- and the fourth a table rebuild that deserves the paragraphs it gets.
--
--   control.published_at      when the control was published, or NULL
--   control.publication_mode  which mode that run used, or NULL
--   users.gmail_address       the professor's connected sending address
--   job.kind                  the CHECK grows a fifth value, `publish`
--
-- Numbered 00017, after 00016_reading_by_student.sql. Numbers are never
-- reused, even deleted ones — the scar is written out in 00002_auth.sql.

-- +goose Up

-- WHY A TIMESTAMP AND NOT A FOURTH `state`
--
-- "Publicado" is a question about a control, and it could have been a
-- fourth value in `control.state`'s CHECK. It is not, for two reasons.
--
-- First, `state` is a POSITION in the correction lifecycle — generated →
-- in_review → graded — and publication is orthogonal to it: a published
-- control is still `graded`, and everything that reads `state` (the close
-- gate, the stats panel, the review page) means the correction, not the
-- distribution. Folding publication in would make every one of those
-- readers wrong by one value on the day it landed.
--
-- Second, a timestamp answers both questions a boolean would need two
-- columns for: whether it was published, and when. The professor's page
-- says "Publicado el 7 de septiembre"; a flag could not.
ALTER TABLE control ADD COLUMN published_at INTEGER;

-- Which mode the publication actually ran in, so the page can say so
-- afterwards and an operator reading the database can tell a rehearsal
-- from the real thing.
--
-- The CHECK admits only the two modes that SEND: `dryrun` and `stub`
-- suppress delivery, so a row claiming to have been published in one of
-- them would assert that students received something nobody sent. Those
-- two are deployment-wide settings (NALANDA_EMAIL_MODE) and never reach
-- this column — a run under them does not stamp the control at all.
--
-- NULL stays legal and is the state of every control that exists today.
ALTER TABLE control ADD COLUMN publication_mode TEXT
    CHECK (publication_mode IS NULL OR publication_mode IN ('real', 'staging'));

-- The Google account the professor authorised this server to send as
-- (issue #273 §The Gmail authorization). NOT the address they log in with:
-- the two are usually the same and are allowed to differ, and the From on
-- a student's email is this one.
--
-- IN THE CLEAR, on purpose, while the refresh token beside it is sealed in
-- `user_secrets` (ADR-0068). The split is the point: the token is a
-- credential and never leaves `secret.Store` as plaintext; the address is
-- something the profile page prints and the message builder reads on every
-- send. Sealing it would mean decrypting on every page render to display a
-- string the professor is looking at anyway, and would put a non-secret
-- inside the blast radius of the master key.
--
-- NULL means "no Gmail connected", which is where every professor starts
-- and where "Desconectar" returns them.
ALTER TABLE users ADD COLUMN gmail_address TEXT;

-- ---------------------------------------------------------------------
-- job.kind grows `publish`
-- ---------------------------------------------------------------------
--
-- SQLite cannot ALTER a CHECK constraint. The constraint is part of the
-- table definition, so admitting a fifth kind means rebuilding the table:
-- create the replacement, copy every row, drop the original, rename. This
-- is the first rebuild in this schema, which is why it is spelled out.
--
-- ADR-0050 is what makes this migration load-bearing rather than cosmetic.
-- The SQLite CHECK and Go's `jobs.ValidKinds` enforce the SAME closed set
-- from two sides, and a Kind that satisfies one but not the other is a
-- silent drop of that entire class of work: the runner would accept a
-- `publish` submission and the INSERT would fail underneath it. The four
-- coordinated places are the Kind constant, this CHECK, the handler
-- factory and the registration in main.go.
--
-- SAFETY OF THE REBUILD, since the obvious worry is foreign keys:
--
--   * `job` is a CHILD (job.control_id → control.id). Nothing in the
--     schema references `job`, so dropping it fires no cascade onto
--     anything else. The rows being copied already satisfy the FK, so
--     re-establishing it on the replacement cannot fail.
--   * The copy is an explicit column list rather than `SELECT *`. A
--     positional copy is correct today and silently wrong the day someone
--     adds a column to one side of this pair.
--   * `idx_job_by_control` goes with the dropped table and is recreated
--     below. A rebuild that forgets the index leaves every row intact and
--     every query slow, which no test that only counts rows would notice
--     — TestTheJobKindRebuildPreservesTheRowsAndTheConstraints asserts the
--     index and the cascade as well as the data.
--
-- Everything else about the table is reproduced verbatim from
-- 00012_jobs.sql; read that file for what each column carries.
CREATE TABLE job_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    control_id    TEXT    NOT NULL REFERENCES control(id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL CHECK (kind IN ('generate', 'analyse', 'reanalyse', 'annotate', 'publish')),
    status        TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    error         TEXT,
    detail        TEXT,
    payload_json  TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    started_at    INTEGER,
    finished_at   INTEGER,
    viewed_at     INTEGER
);

INSERT INTO job_new (
    id, control_id, kind, status, error, detail, payload_json,
    created_at, started_at, finished_at, viewed_at
)
SELECT
    id, control_id, kind, status, error, detail, payload_json,
    created_at, started_at, finished_at, viewed_at
FROM job;

DROP TABLE job;

ALTER TABLE job_new RENAME TO job;

-- Same index, same reason as 00012: the Detail handler asks for "the most
-- recent job on this control".
CREATE INDEX idx_job_by_control ON job (control_id, created_at DESC);

-- +goose Down

-- Documentation of the inverse, never executed: ADR-0034 §Consequences
-- records that rolling a binary back over an applied migration is not
-- supported (backend-code-style.md §Adding a migration, rule 2).
--
-- The three ALTERs below are the inverse of the three above. THE JOB
-- REBUILD IS DELIBERATELY NOT INVERTED, and saying so is the point: its
-- inverse is another rebuild that would first have to DELETE every
-- `publish` row, because the rows this migration made legal are exactly
-- what the narrower CHECK refuses. Destroying a professor's job history to
-- satisfy a rollback nobody supports is worse than leaving the wider CHECK
-- in place, which costs nothing on a binary that no longer emits the value.
--
-- An earlier version of this comment described that rebuild as though the
-- block performed it, and the block only dropped an index (#273 review,
-- ARQ-8). The index is left alone here too — it belongs to `job`, which
-- this Down does not touch.
ALTER TABLE users DROP COLUMN gmail_address;
ALTER TABLE control DROP COLUMN publication_mode;
ALTER TABLE control DROP COLUMN published_at;
