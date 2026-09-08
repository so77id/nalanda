-- Issue #287: publication stops being one fact about a CONTROL and becomes
-- one fact per COPY.
--
-- #273 recorded a publication as a timestamp, a mode and a COUNT of the
-- messages that went out. Not who. Three consequences, all found by
-- publishing a real class on 2026-09-08: a run that dies mid-loop leaves
-- nobody knowing who received their correction, a per-copy failure cannot be
-- retried without mailing the whole class again, and a re-corrected copy
-- cannot be re-sent at all.
--
-- Two columns answer all three, because they answer the question the count
-- could not: WHICH copies went out, and with WHAT on them.
--
-- Numbered 00019, after 00018_published_sent.sql. Numbers are never reused,
-- even deleted ones — the scar is written out in 00002_auth.sql.

-- +goose Up

-- When this copy's own message went out. NULL is "never sent", which is the
-- state of every reading that exists today and of every copy a publication
-- skipped or has not reached yet.
--
-- On `reading` rather than on a new table because the reading IS the copy:
-- the row already carries a UNIQUE (control_id, copy_number), which is the
-- key a publication addresses, and a side table would be a second row to
-- keep in step with a reading that is upserted on every re-read.
--
-- The property the whole feature rests on is that this SURVIVES a
-- re-analysis. `upsertReading`'s ON CONFLICT DO UPDATE SET names its columns
-- explicitly (rut_read, rut_status, copy_status, read_at, pages_json), so a
-- column it does not name is left exactly as it was — re-reading at another
-- sensitivity must not erase the record of what a student already received.
-- That is asserted at the store level rather than trusted to this comment
-- (TestUpsertingAReportPreservesThePerCopyPublication).
ALTER TABLE reading ADD COLUMN published_at INTEGER;

-- The grade that WENT OUT, as text.
--
-- A string and not a REAL, and the difference is load-bearing. What travels
-- to the student is `FormatGrade`'s output — the one place the 1.0–7.0
-- arithmetic lives (ADR-0031, #251's cannot-disagree rule) — and storing the
-- float would mean a second rounding somewhere else the day anything
-- compares them. The comparison this column exists for is
-- "is what I would send now the same as what I sent then", and comparing the
-- two canonical strings is the only version of that question with one
-- answer.
--
-- NULL alongside a NULL published_at is "never sent". The pair is written
-- together, in one statement, by the same call.
ALTER TABLE reading ADD COLUMN published_grade TEXT;

-- `control.published_sent` is NOT dropped here. It becomes derivable the
-- moment these two columns exist — the count is the stamped readings — but
-- its readers are still standing at this point in the WP, and a migration
-- that removes a column the shipped binary still SELECTs is a boot that
-- works and a page that 500s. It goes in 00020, in the slice that removes
-- the last of them.

-- +goose Down

-- Documentation of the inverse, never executed: ADR-0034 §Consequences
-- records that rolling a binary back over an applied migration is not
-- supported (backend-code-style.md §Adding a migration, rule 2).
--
-- Genuinely invertible, unlike 00017's job rebuild: dropping a column
-- SQLite added is the same operation in reverse, and it destroys only what
-- this migration made storable in the first place.
ALTER TABLE reading DROP COLUMN published_grade;
ALTER TABLE reading DROP COLUMN published_at;
