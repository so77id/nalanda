-- The reading half of the entrance-controls subsystem (issue #167, WP-F).
-- Four tables:
--
--   reading          one row per copy READ (or explicitly not_present)
--   answer           one row per question of a reading, in the pool's order
--   answer_override  the professor's edit for one (reading, question_ref)
--   rut_override     the professor's typed RUT for one reading
--
-- The two override tables are kept apart from their base rows so an
-- INSERT is what a save is (never UPDATE OR INSERT), and the pre-override
-- state is what the answer row still holds. A future audit reads what AMC
-- read AND what the professor decided from the same query
-- (docs/design/2026-08-controles.md §The domain, note on Override).
--
-- The report's rut_status carries two values on the wire ('ok' | 'unreadable'),
-- ADR-0031. A third value 'not_present' is used HERE on reading rows for
-- copias that were printed but never captured — the results table renders
-- them as "no rendida" without them counting toward "requieren revisión".

-- +goose Up

CREATE TABLE reading (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    control_id     TEXT    NOT NULL REFERENCES control(id) ON DELETE CASCADE,
    -- 1-based, matches copia.numero and AMC's printed \onecopy index.
    copy_number    INTEGER NOT NULL CHECK (copy_number > 0),
    -- Nullable: the RUT boxes may be unreadable, or the copy may be
    -- not_present at all.
    rut_read       TEXT,
    rut_status     TEXT    NOT NULL CHECK (rut_status IN ('ok', 'unreadable', 'not_present')),
    copy_status    TEXT    NOT NULL CHECK (copy_status IN ('ok', 'needs_review', 'incomplete', 'not_present')),
    -- unix seconds. read_at is when this row's answers were last updated
    -- from a report (analyse or reanalyse); last_edited_at is set when
    -- any override lands, and is what tells the UI a copy was touched by
    -- a human.
    read_at        INTEGER NOT NULL,
    last_edited_at INTEGER,
    -- One reading per copia. The UNIQUE is what UPSERT keys on when a
    -- second /analyse arrives for the same batch and adds pages.
    UNIQUE (control_id, copy_number)
);
CREATE INDEX idx_reading_by_control ON reading (control_id, copy_number);

CREATE TABLE answer (
    reading_id    INTEGER NOT NULL REFERENCES reading(id) ON DELETE CASCADE,
    -- The bank id (control_pregunta.pregunta_ref). Comes from AMC's
    -- layout_question.name at read time; the wrapper resolves it against
    -- the pool.
    question_ref  TEXT    NOT NULL,
    -- The engine's own scoring type. Load-bearing because AMC weighs a
    -- simple question 1 and a multiple one-point-per-alternative, and
    -- the caller normalises differently between the two (ADR-0031 §Every
    -- question weighs one point).
    question_type TEXT    NOT NULL CHECK (question_type IN ('simple', 'multiple')),
    -- JSON arrays. Two columns kept as text because sqlite has no array
    -- type, and the natural read shape is "here is the whole list at
    -- once"; a normalised child table would answer that read with a
    -- second query for every question.
    marked_json   TEXT    NOT NULL,
    doubtful_json TEXT    NOT NULL,
    status        TEXT    NOT NULL CHECK (status IN ('ok', 'blank', 'ambiguous', 'doubtful')),
    -- Score/max are what the engine returned. The relative and the grade
    -- are computed on the fly in Go — computing them here would freeze
    -- the arithmetic in the schema.
    score         REAL    NOT NULL,
    max           REAL    NOT NULL,
    PRIMARY KEY (reading_id, question_ref)
);

CREATE TABLE answer_override (
    reading_id    INTEGER NOT NULL,
    question_ref  TEXT    NOT NULL,
    marked_json   TEXT    NOT NULL,
    status        TEXT    NOT NULL CHECK (status IN ('ok', 'blank', 'ambiguous', 'doubtful')),
    edited_at     INTEGER NOT NULL,
    PRIMARY KEY (reading_id, question_ref),
    -- No FK to answer(reading_id, question_ref): a re-read replaces the
    -- answer rows, and if the FK cascaded the override would go with
    -- them. The reading FK is what survives incremental captures.
    FOREIGN KEY (reading_id) REFERENCES reading(id) ON DELETE CASCADE
);

CREATE TABLE rut_override (
    reading_id INTEGER NOT NULL,
    rut        TEXT    NOT NULL,
    edited_at  INTEGER NOT NULL,
    PRIMARY KEY (reading_id),
    FOREIGN KEY (reading_id) REFERENCES reading(id) ON DELETE CASCADE
);

-- +goose Down

DROP TABLE rut_override;
DROP TABLE answer_override;
DROP TABLE answer;
DROP TABLE reading;
