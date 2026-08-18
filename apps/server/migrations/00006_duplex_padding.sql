-- Issue #185: the professor opts out of the padded-to-even-pages layout by
-- unchecking a form checkbox at creation time. The generator emits either
-- \AMCcleardoublepage (padded, historical) or \clearpage (single page per
-- copy) depending on this bit. See ADR-0033 §The sheet carries its own
-- arithmetic for the surrounding layout decisions.
--
-- Stored as INTEGER because SQLite has no native BOOL — 0/1 is the shape the
-- rest of the schema uses (see users.is_active in 00002_auth.sql). Default 1
-- covers three cases in one line: pre-migration controls (the check happens
-- at read), test inserts that omit the column (schema_test.go), and any
-- caller that forgets to send it. The default matches the current behaviour
-- so nothing existing breaks.
--
-- NOT NULL for the same reason the sibling columns are: reading a NULL
-- would leave the generator branching on Go's tri-state and open a bug the
-- schema can refuse.
--
-- CHECK (duplex_padding IN (0, 1)) makes the two-value shape self-enforcing:
-- the read path is `c.DuplexPadding = duplexPadding != 0`, which silently
-- coerces 2 or -1 to true. No writer produces those today; the CHECK costs
-- nothing and refuses the mistake at the schema (Round A local-review,
-- item 6).

-- +goose Up
ALTER TABLE control ADD COLUMN duplex_padding INTEGER NOT NULL DEFAULT 1
    CHECK (duplex_padding IN (0, 1));

-- +goose Down
ALTER TABLE control DROP COLUMN duplex_padding;
