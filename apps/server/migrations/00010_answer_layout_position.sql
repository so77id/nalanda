-- Issue #229: preserve per-copy printed order on the review page.
--
-- AMC shuffles both the questions per copy (\shufflegroup) and the
-- alternatives per question. read_capture now publishes those two orders on
-- the wire per answer (`position` + `alternatives`), and this column pair
-- records them so the review page can render each copy the way its student
-- saw it. Without them the professor's paper in hand did not match the
-- order on screen — the marks were read correctly, but the mental
-- alignment broke.
--
-- Nullable, no backfill. Readings landed before this migration have no
-- positional data and stay legible via loadAnswers' fallback ORDER BY
-- (position IS NULL first, then question_ref) — which is what they were
-- rendered by before this change. Backfilling a made-up position would be
-- the silent-wrong shape ADR-0031 exists to forbid: no answer was ever
-- printed at some "position that happens to be its rowid".
--
-- Two columns on `answer` rather than a child answer_alternative_position
-- table, for the same reason marked_json and doubtful_json sit here
-- (00005_readings.sql, the `answer` table's inline comment on those two
-- columns): the natural read shape is "here is the whole list at once",
-- and a normalised table would answer every render with an extra query
-- per question.

-- +goose Up
ALTER TABLE answer ADD COLUMN position INTEGER;
ALTER TABLE answer ADD COLUMN alternatives_json TEXT;

-- +goose Down
ALTER TABLE answer DROP COLUMN alternatives_json;
ALTER TABLE answer DROP COLUMN position;
