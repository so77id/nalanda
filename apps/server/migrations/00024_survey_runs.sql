-- Issue #310 S2 (WP-2 of epic #308): a survey is applied one or more
-- times, and each application is a RUN — a name, a date, a number of
-- copies, and the PDF the worker generates for it.
--
--   survey_run           one row per application of a survey
--   survey_run_question  which questions that run printed, and as which
--                        printed number
--
-- The snapshot exists because the bank can GROW after a run: once a
-- non-cancelled run exists, existing questions are locked (no edit, no
-- delete, no move — survey.ErrBankLocked) but new ones may be appended,
-- and only later runs print them. A question absent from an earlier run's
-- snapshot is the `—` of the comparison (WP-4).
--
-- `state` is the run's own life, not its jobs': PDF generation and scan
-- reading are job states (00023, ADR-0079), and "reviewing" is derived
-- from the review queue (#311).
--
-- `number` is per survey and printed in the UI ("Pasada #3"); the UNIQUE
-- is the belt behind the store's max+1 inside one transaction.
--
-- Numbered 00024, after 00023_job_subject.sql.

-- +goose Up
CREATE TABLE survey_run (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id   INTEGER NOT NULL REFERENCES survey(id),
    number      INTEGER NOT NULL CHECK (number >= 1),
    name        TEXT    NOT NULL DEFAULT '',
    -- YYYY-MM-DD, the day the sheets are applied in class.
    applied_on  TEXT    NOT NULL CHECK (applied_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    copies      INTEGER NOT NULL CHECK (copies BETWEEN 1 AND 200),
    state       TEXT    NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'cancelled')),
    created_by  INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    closed_at   INTEGER,
    UNIQUE (survey_id, number)
);

CREATE TABLE survey_run_question (
    run_id          INTEGER NOT NULL REFERENCES survey_run(id) ON DELETE CASCADE,
    -- RESTRICT (the default): a question a run printed cannot be deleted,
    -- the schema's belt behind the bank lock.
    question_id     INTEGER NOT NULL REFERENCES survey_question(id),
    printed_number  INTEGER NOT NULL CHECK (printed_number >= 1),
    PRIMARY KEY (run_id, question_id),
    UNIQUE (run_id, printed_number)
);

-- +goose Down
DROP TABLE survey_run_question;
DROP TABLE survey_run;
