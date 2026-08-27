-- Issue #249: async job runner for the four minutes-class AMC operations
-- (generate, analyse, reanalyse, annotate batch). One row per submission,
-- persisted so the queue survives Watchtower restarts (ADR-0038) and the
-- server sweeps `running` rows into `failed` at boot rather than leaving
-- them dangling.
--
-- Times are unix seconds in INTEGER columns, matching every other table
-- (job.created_at, started_at, finished_at, viewed_at). Nullable
-- started_at/finished_at carry "not started yet / not finished yet";
-- nullable viewed_at is "the banner has not been dismissed".
--
-- payload_json holds the runner's inputs verbatim so a Sweep-requeued
-- job can be re-executed by the runner without hitting anything else in
-- the schema. The shape is kind-specific: analyse carries a batch name +
-- thresholds (controls.AnalysePayload); reanalyse carries thresholds
-- (controls.ReanalysePayload); generate and annotate carry the empty
-- object `{}` (controls.EmptyPayload) because their async methods read
-- the control row for what they need. The runner unmarshals against the
-- kind stored on the row.
--
-- error is the short one-line message the banner renders (typically
-- AnalyzerRefusedError.Message); detail carries the long context for
-- future debugging (AnalyzerRefusedError.Detail). Same
-- shape-of-two-fields as the wrapped error the amcworker client returns.

-- +goose Up
CREATE TABLE job (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    control_id    TEXT    NOT NULL REFERENCES control(id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL CHECK (kind IN ('generate', 'analyse', 'reanalyse', 'annotate')),
    status        TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    error         TEXT,
    detail        TEXT,
    payload_json  TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    started_at    INTEGER,
    finished_at   INTEGER,
    viewed_at     INTEGER
);

-- The Detail handler asks for "the most recent job on this control" —
-- (control_id, created_at DESC) covers it.
CREATE INDEX idx_job_by_control ON job (control_id, created_at DESC);

-- +goose Down

DROP TABLE job;
