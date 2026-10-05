-- Issue #310 S1 (WP-2 of epic #308): the job queue's subject is no longer
-- always a control. A survey RUN has minutes-class worker work too (its PDF
-- generation now, its scan reading in #311), and ADR-0050's one runner is
-- what serialises every call against the worker client's single lock — a
-- second queue would mean a second goroutine contending for it. ADR-0079.
--
--   control_id  →  subject_kind ('control' | 'survey_run') + subject_id
--   kind CHECK  →  + 'survey_generate'
--
-- `subject_kind` is derived from `kind` by the domain (jobs.Kind.Subject):
-- stored rather than recomputed so the "latest job on this subject" query
-- is one indexed lookup that cannot confuse a control id with a run id.
--
-- THE FOREIGN KEY GOES, and its cascade with it. A column that points at
-- two tables cannot carry a REFERENCES, so purging a control no longer
-- removes its jobs by itself: controlstore.PurgeControl deletes them in its
-- own transaction (pinned by TestPurgeControlRemovesTheControlsJobs). A
-- survey run is never hard-deleted in v1 (ADR-0078 §Consequences).
--
-- Rebuild recipe (backend-code-style.md §Extending a CHECK enum): `job` is
-- a CHILD — job.control_id → control.id — and nothing references `job`, so
-- dropping it fires no cascade and loses no other table's rows. The copy
-- names its columns; the one index is recreated under a name that says
-- what it now covers. Existing rows are all controls' jobs.
--
-- The Down DOCUMENTS the inverse rather than performing it: narrowing back
-- would first have to delete every survey_run row the Up made legal.
--
-- Numbered 00023, after 00022_surveys.sql.

-- +goose Up
CREATE TABLE job_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_kind  TEXT    NOT NULL CHECK (subject_kind IN ('control', 'survey_run')),
    subject_id    TEXT    NOT NULL,
    kind          TEXT    NOT NULL CHECK (kind IN ('generate', 'analyse', 'reanalyse', 'annotate', 'publish',
                                                   'survey_generate')),
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
    id, 'control', control_id, kind, status, error, detail, payload_json,
    created_at, started_at, finished_at, viewed_at, notice
FROM job;

DROP TABLE job;
ALTER TABLE job_new RENAME TO job;

-- "The most recent job on this subject" (the banner) and "of this kind"
-- (the PDF gate) — the same shape idx_job_by_control served, one column
-- wider.
CREATE INDEX idx_job_by_subject ON job (subject_kind, subject_id, created_at DESC);

-- +goose Down
-- Documented, not performed (see the header): the inverse is a rebuild back
-- to `control_id TEXT NOT NULL REFERENCES control(id) ON DELETE CASCADE`
-- keeping only subject_kind = 'control' rows, with idx_job_by_control.
SELECT 1;
