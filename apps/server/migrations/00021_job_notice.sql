-- Issue #298: a job can SUCCEED and still have something to tell the
-- professor.
--
-- An analyse that re-read copies already mailed to their students is the
-- case that needed it: refusing it would force an unpublish of the whole
-- control to fix one sheet (ADR-0073 owns re-sending per copy), and a bare
-- "análisis lista" over it would leave the professor unaware that some
-- students may now hold a stale grade. `error` and `detail` belong to the
-- failed row; this is the done row's one sentence, rendered under "lista".
--
-- NULL on every existing row, and on every done job with nothing to say.
--
-- Numbered 00021, after 00020_drop_published_sent.sql.

-- +goose Up
ALTER TABLE job ADD COLUMN notice TEXT;

-- +goose Down
ALTER TABLE job DROP COLUMN notice;
