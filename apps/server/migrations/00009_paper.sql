-- Issue #208: the professor picks Letter or A4 in a `<details> Opciones
-- avanzadas` block on the create form. The value persists on the control so a
-- future WP-G regenerate honours it, and the tex generator reads it into the
-- \documentclass option (Letter → `letterpaper`, A4 → `a4paper`). See ADR-0043
-- for the reversal that ADR-0042 predicted and rejected.
--
-- Stored as TEXT because the two values are named, not numeric — the same
-- reason `state` is TEXT (00004) and `code_language` (00003) is. An INTEGER
-- would force everyone reading the column to remember which bit means A4,
-- which is exactly the "wrong-option trap" ADR-0042 §Alternatives named.
--
-- Default 'letter' covers three cases in one line: pre-migration controls (a
-- read then answers with the ADR-0043 default), test inserts that omit the
-- column (schema_test.go), and any caller that forgets to send it. The
-- default also matches ADR-0042's operational choice for the Chilean
-- printer default — the reversal makes it configurable, not the default.
--
-- NOT NULL for the same reason the sibling columns are: reading a NULL would
-- leave the generator branching on Go's zero-value ("") and open a bug the
-- schema can refuse.
--
-- CHECK (paper IN ('letter', 'a4')) makes the two-value shape self-enforcing.
-- The domain type `Paper` in internal/domain/controls carries the same set,
-- and the handler validates the form submission — but a stray writer that
-- bypasses both would land here, and the CHECK is the last gate. Same shape
-- as duplex_padding's CHECK in 00006.

-- +goose Up
ALTER TABLE control ADD COLUMN paper TEXT NOT NULL DEFAULT 'letter'
    CHECK (paper IN ('letter', 'a4'));

-- +goose Down
ALTER TABLE control DROP COLUMN paper;
