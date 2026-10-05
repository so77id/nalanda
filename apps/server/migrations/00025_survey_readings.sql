-- Issue #311 S1 (WP-3 of epic #308): what the worker read off a run's
-- scanned sheets, stored WITHOUT identity.
--
--   survey_copy         one row per sheet AMC captured: its copy number
--                       (printed on the sheet, never a person) and the
--                       pages it was captured from
--   survey_mark         one row per alternative recorded on a copy —
--                       never a CSV in one column, so WP-4 counts with
--                       GROUP BY
--   survey_review_item  one row per answer the reader was unsure of
--                       (two marks on a one-answer question, or a mark in
--                       the unsure darkness band); it writes NO mark until
--                       the professor resolves it
--
-- A re-captured copy is deleted and inserted again (survey_copy's cascade
-- takes its marks and items with it); any other copy is re-read for what
-- is still undecided, and keeps every decision (surveystore.SaveReadings).
--
-- survey_mark and survey_review_item point at the bank with no ON DELETE
-- clause (NO ACTION): the run that holds them locks those questions
-- (ADR-0080 §2), so the belt never has to fire.
--
-- Numbered 00025, after 00024_survey_runs.sql.

-- +goose Up
CREATE TABLE survey_copy (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       INTEGER NOT NULL REFERENCES survey_run(id) ON DELETE CASCADE,
    -- AMC's copy number, 1-based: which printed sheet, never who.
    copy_number  INTEGER NOT NULL CHECK (copy_number >= 1),
    -- The physical pages AMC captured the copy from, as a JSON array of
    -- page numbers (the review page shows them).
    pages_json   TEXT    NOT NULL DEFAULT '[1]',
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (run_id, copy_number)
);

CREATE TABLE survey_mark (
    copy_id         INTEGER NOT NULL REFERENCES survey_copy(id) ON DELETE CASCADE,
    question_id     INTEGER NOT NULL REFERENCES survey_question(id),
    alternative_id  INTEGER NOT NULL REFERENCES survey_alternative(id),
    PRIMARY KEY (copy_id, question_id, alternative_id)
);

CREATE TABLE survey_review_item (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    copy_id      INTEGER NOT NULL REFERENCES survey_copy(id) ON DELETE CASCADE,
    question_id  INTEGER NOT NULL REFERENCES survey_question(id),
    reason       TEXT    NOT NULL CHECK (reason IN ('ambiguous', 'doubtful')),
    -- JSON: {"marked": [alternative ids], "doubtful": [alternative ids]} —
    -- what the reader saw, so the review page can offer exactly that.
    detected     TEXT    NOT NULL,
    -- NULL while pending.
    resolution   TEXT    CHECK (resolution IN ('chosen', 'discarded')),
    comment      TEXT    NOT NULL DEFAULT '',
    resolved_at  INTEGER,
    resolved_by  INTEGER REFERENCES users(user_id),
    -- A resolution is stamped whole or not at all.
    CHECK ((resolution IS NULL) = (resolved_at IS NULL)),
    UNIQUE (copy_id, question_id)
);

-- The review queue reads "pending items of this run, by copy".
CREATE INDEX idx_survey_review_item_pending ON survey_review_item (copy_id) WHERE resolution IS NULL;

-- +goose Down
DROP INDEX idx_survey_review_item_pending;
DROP TABLE survey_review_item;
DROP TABLE survey_mark;
DROP TABLE survey_copy;
