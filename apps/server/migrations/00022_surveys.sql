-- Issue #309 (WP-1 of epic #308): the survey bank. Three tables, the
-- whole of what a professor authors before anything is printed:
--
--   survey               one row per survey; belongs to ONE course
--   survey_question      its questions, in bank order
--   survey_alternative   each question's answers, in printed order
--
-- Anonymous by design (ADR-0078): nothing here, nor in the run and reading
-- tables WP-2/3 add, ever points at `student` or `enrollment`. The only
-- person a survey names is the professor who created it.
--
-- `survey.id` is an INTEGER, unlike `control.id`'s random TEXT: a control
-- id is PRINTED on every copy, where a sequence would leak a count; a
-- survey id is printed nowhere and only ever appears behind the professor
-- gate (the same reasoning 00014 gives for `course.id`).
--
-- Times are unix seconds, like every other table here.
--
-- No index beyond the UNIQUEs: the readers are "this course's surveys"
-- (tens of rows a course, a scan is free) and "this survey's bank" (which
-- the UNIQUE (survey_id, position) already serves). An index ships with
-- the slice whose query needs it (backend-code-style.md §Adding a
-- migration, rule 7).
--
-- Numbered 00022, after 00021_job_notice.sql.

-- +goose Up
CREATE TABLE survey (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- RESTRICT (the default): a course with surveys cannot be deleted from
    -- under them, the same rule `control.course_id` follows.
    course_id    INTEGER NOT NULL REFERENCES course(id),
    name         TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    -- Printed under the title on the sheet (WP-2). '' when there is none.
    description  TEXT    NOT NULL DEFAULT '',
    created_by   INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    -- NULL = active. Soft, and reversible: archiving hides a survey from
    -- its course's list and destroys nothing.
    archived_at  INTEGER
);

CREATE TABLE survey_question (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id   INTEGER NOT NULL REFERENCES survey(id) ON DELETE CASCADE,
    -- 1-based and dense within the survey; the domain keeps it dense.
    position    INTEGER NOT NULL CHECK (position >= 1),
    kind        TEXT    NOT NULL CHECK (kind IN ('single', 'scale', 'multi')),
    statement   TEXT    NOT NULL CHECK (length(trim(statement)) > 0),
    -- A free-text label, not an entity (ADR-0078 §Decision 4); '' = none.
    section     TEXT    NOT NULL DEFAULT '',
    -- Only a single-choice question may be a context question: the results
    -- filter selects copies by ONE alternative of it (WP-4).
    is_context  INTEGER NOT NULL DEFAULT 0
                CHECK (is_context IN (0, 1))
                CHECK (is_context = 0 OR kind = 'single'),
    -- Printed guidance for a multi-select question; enforced by nothing,
    -- because paper cannot refuse a fourth mark. NULL = unset.
    min_marks   INTEGER CHECK (min_marks IS NULL OR (kind = 'multi' AND min_marks >= 0)),
    max_marks   INTEGER CHECK (max_marks IS NULL OR (kind = 'multi' AND max_marks >= 1)),
    UNIQUE (survey_id, position)
);

CREATE TABLE survey_alternative (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id  INTEGER NOT NULL REFERENCES survey_question(id) ON DELETE CASCADE,
    -- 1-based printed order; for a scale, the point's value.
    position     INTEGER NOT NULL CHECK (position >= 1),
    -- May be '' for a scale point printed with its number only.
    label        TEXT    NOT NULL DEFAULT '',
    UNIQUE (question_id, position)
);

-- +goose Down
DROP TABLE survey_alternative;
DROP TABLE survey_question;
DROP TABLE survey;
