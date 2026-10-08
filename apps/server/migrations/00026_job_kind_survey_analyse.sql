-- Issue #311 S3 (WP-3 of epic #308): reading a survey run's scans is a
-- job — `survey_analyse`, about a survey run (jobs.Kind.Subject, ADR-0079).
-- job.kind's CHECK is the schema half of the Kind enum (the four-places
-- rule, apps/server/CLAUDE.md), so it widens, and SQLite widens a CHECK
-- only by rebuilding the table.
--
-- Rebuild recipe (backend-code-style.md §Extending a CHECK enum): since
-- 00023 `job` references nothing and nothing references it, so dropping
-- it fires no cascade. Every column is copied by name, and the one index
-- is recreated under the name it already had.
--
-- The Down DOCUMENTS the inverse rather than performing it: narrowing back
-- would first have to delete every survey_analyse row the Up made legal.
--
-- Numbered 00026, after 00025_survey_readings.sql.

-- +goose Up
CREATE TABLE job_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_kind  TEXT    NOT NULL CHECK (subject_kind IN ('control', 'survey_run')),
    subject_id    TEXT    NOT NULL,
    kind          TEXT    NOT NULL CHECK (kind IN ('generate', 'analyse', 'reanalyse', 'annotate', 'publish',
                                                   'survey_generate', 'survey_analyse')),
    status        TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    error         TEXT,
    detail        TEXT,
    payload_json  TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    started_at    INTEGER,
    finished_at   INTEGER,
    viewed_at     INTEGER,
    notice        TEXT
);

INSERT INTO job_new (
    id, subject_kind, subject_id, kind, status, error, detail, payload_json,
    created_at, started_at, finished_at, viewed_at, notice
)
SELECT
    id, subject_kind, subject_id, kind, status, error, detail, payload_json,
    created_at, started_at, finished_at, viewed_at, notice
FROM job;

DROP TABLE job;
ALTER TABLE job_new RENAME TO job;

CREATE INDEX idx_job_by_subject ON job (subject_kind, subject_id, created_at DESC);

-- +goose Down
-- Documented, not performed (see the header): the inverse is this same
-- rebuild without 'survey_analyse', after deleting its rows.
SELECT 1;
