# ADR-0082: survey results count closed runs, from marks, at request time

**Status:** Accepted
**Date:** 2026-10-05
**Decision-makers:** Miguel Rodriguez
**Source:** epic #308, WP-4 #312 (S1–S7). Reads what ADR-0080 (the run
model) and ADR-0081 (the reading) store; adds no table.

## Context

After #311 a closed run's answers are rows of `survey_mark`: one per
alternative a copy recorded, with no identity. The professor needs, per run,
each question's distribution with the statistics its kind supports, a way to
look at one group without identifying anyone, and — the reason a survey has
runs at all — a comparison across runs of the same bank. Nothing here may
change what the earlier WPs store.

## Decision

1. **Closed runs only** (ADR-0081 §7). An open or cancelled run's results
   URL redirects to its dashboard; the comparison and the "in every closed
   run" lines skip open runs. A number a professor has read never moves.
2. **Answered is a mark; everything else is "sin respuesta".** A copy
   answered a question when it holds at least one `survey_mark` row for it.
   A blank sheet, a discarded review item and a question on a page that was
   never captured all leave none, and count alike: `survey.ReadReport` writes
   marks only for answers the report carries, and a discard writes nothing
   (ADR-0081 §2, §4). `survey_review_item` is never read for results.
3. **The bases.** A single or scale question's percentages are over the
   copies that answered it; a multi-select's over every copy in the set — a
   student may tick none and still have read it. Copies are the sheets READ
   (`survey_copy`), never the copies printed.
4. **A scale's value is its alternative's position** (1-based; the label may
   be empty). Mean, median — the mean of the two middle values when the
   count is even — and every mode tied for the top.
5. **The context filter** restricts every block of the run's page (and of
   one question's) to the copies that marked one
   of the chosen alternatives of one of the run's printed context questions.
   **No minimum group size** (Miguel, 2026-10-05): a filter that leaves one
   copy shows one copy. A question's line "in every closed run" (screen 6)
   is NOT filtered — a filter is defined by one run's context answers —
   and the page says so.
6. **The comparison** has one row per question some closed run printed,
   numbered by its BANK position (a printed number differs between runs: the
   bank grows, context prints first), one column per closed run, oldest
   first. A scale row shows the chosen metric (a table cell holds one number,
   so a tied mode shows its lowest value); a single or multi row shows the
   share of a **reference alternative**, the most marked in the latest closed
   run that printed the question and has a mark on it (a later run nobody
   answered it in does not blank the earlier ones; ties go to bank order).
   Context rows and runs that did not print the question show
   "—", and so does a single or scale cell nobody answered; a multi-select
   cell over read copies is a real 0 % (§3) and counts in Δ. **Δ = the last value
   − the first**, needing two, shown with its sign and an arrow and **no
   colour**: the system does not know which direction is good.
7. **The store counts, the domain computes, at request time.** One aggregate
   query per set of copies — a `UNION ALL` of copies, marks per alternative and
   copies answering per question over one run's (`RunTally`, which also counts
   the run's read copies, unfiltered), or over every closed run with
   what each printed (`ClosedRunTallies`). Screens 7 and 13 run one; screen 6
   runs both, never one per question. No cached
   aggregate, no new table, no migration.
8. **Exports** are UTF-8 with a BOM, comma-separated, every field quoted. The
   raw export numbers its rows 1…N in an order hashed from (run, copy) — the
   same on every export, and never one that follows AMC's copy numbers,
   which it does not carry either. The hash is unkeyed: it stops a row
   number from reading as a copy number, not a determined reader
   (`docs/security-notes.md`, #312 amendment). The comparison export is for analysis:
   bare numbers (a scale in the chosen metric, a percent 0–100), an empty
   cell where the page shows "—", what each row measures in its own column,
   and the metric in the file's name. Text the professor typed that a
   spreadsheet would run as a formula is prefixed with an apostrophe.

## Alternatives considered

- **Percent over the copies printed.** It counts sheets that never came back
  as blank answers. Rejected (§3).
- **A minimum group size for the filter** (k-anonymity). The professor owns
  the data and asked for none; a small class would lose its filter. Rejected
  for v1 (Miguel, 2026-10-05).
- **Coloured Δ.** A scale whose best value is in the middle (a "ritmo" of
  1–4) makes "up" neither good nor bad. Rejected.
- **Materialised results per run.** Closed runs never change, so a cache
  would be correct, but a class-sized run aggregates in milliseconds and a
  cache is one more thing a reset or a future reopen must invalidate. Kept
  for #313 if it is ever needed.

## Consequences

- Reopening a closed run (#313) changes numbers that were shown; it must say
  so.
- A question added to the bank after a run appears in the comparison only
  from the runs that printed it; its earlier cells are "—", its Δ starts
  later.
