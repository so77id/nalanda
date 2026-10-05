# ADR-0081: a survey run is read per answer, without identity, and reset like a control

**Status:** Accepted — the survey sheet is not yet proven on paper (ADR-0080
§Not yet proven, `apps/amc-worker/PAPER-CHECK.md` §7)
**Date:** 2026-10-05
**Decision-makers:** Miguel Rodriguez
**Source:** epic #308, WP-3 #311 (S1–S6). Builds on ADR-0080 (the run
model) and ADR-0079 (the queue); amends ADR-0075 §5 and ADR-0050's #298
amendment (a second synchronous worker call).

## Context

A survey run's sheets come back scanned, like a control's, and the same
worker reads them (`/analyse`, single-mode capture since ADR-0075). But a
survey has no identity to read and no grade to compute, and its reader's
report says so badly: with no ID grid every copy reads `rut_status:
unreadable` and every copy is `needs_review`, clean or not (ADR-0080 §8,
measured in S0). What a survey needs from the report is narrower — which
alternatives each copy marked, and which answers a human must decide —
and what the professor needs is to throw a batch away and start over, as
they can for a control (ADR-0075 §5).

## Decision

1. **A copy is a sheet, never a person.** `survey_copy` keys on the run
   and AMC's copy number; nothing reads, stores or matches an identity.
2. **The reader keys on each answer's status; the copy's status, RUT and
   score are ignored.** `survey.ReadReport` maps a question by its AMC
   name (`q<id>`) and an alternative by AMC's answer number — its position
   in the source, which is the bank's order because the sheet is
   unshuffled and the run locks the bank (ADR-0080 §2). `ok` writes one
   `survey_mark` per marked alternative; `blank` writes nothing;
   `ambiguous` and `doubtful` write ONE review item with what was seen and
   **no mark — not even a confident mark beside a faint one**: the student
   may have erased the wrong box, and that is the professor's call. A name,
   an answer number or a status the run never printed refuses the whole
   batch (`ErrReportMismatch`) before anything is written.
3. **A later batch replaces only what it re-captured.** AMC's report
   covers the whole project, so every batch brings back the copies of the
   earlier ones. `SaveReadings` deletes and re-inserts the copies in
   `batch.recaptured_copies`, inserts new ones, and leaves every other
   existing copy untouched — the professor's resolutions included. A batch
   with no page of the run is refused (`ErrNothingCaptured`, the only loud
   signal single-mode capture gives, ADR-0075).
4. **A resolution is recorded, never edited.** The review writes the
   chosen marks (exactly one on a single or scale, at least one on a
   multi, always the question's own alternatives) or nothing for
   "Descartar", stamps who and when, keeps the comment, and refuses a
   second decision on the same item (`ErrItemResolved`). Undoing one is
   "Borrar escaneos" and a new batch.
5. **"Borrar escaneos" for a survey run is the SECOND synchronous worker
   call.** It is ADR-0075 §5's reset with the survey's own client method
   (`amcworker.Client.ResetSurveyScans`, sharing the wire with
   `ResetScans` through a helper that takes the caller's sentinels, as
   `GenerateSheet` shares `generate()`), so the survey never names a
   controls error. It qualifies on the two properties the first exception
   was granted for: it only removes files, and it never waits on the
   client's lock (`TryLock`, `survey.ErrAnalyzerBusy` → 409). It keeps the
   same departures from the fourth synchronous rule: 409 while a job of
   the run is in flight, and a jobs-store read failure fails CLOSED. The
   worker goes first; only then are the copies deleted.
6. **A run with scans is not cancelled** (`ErrRunHasScans`): an uploaded
   batch is enough — one whose reading failed is exactly what the reset
   exists for — and a read copy is checked in the cancel's own statement.
   Cancelling releases the bank lock (ADR-0080 §5) under readings that
   would then count nowhere. Start over with "Borrar escaneos" first.

## Alternatives considered

- **Reuse `Client.ResetScans`.** It returns `controls.ErrAnalyzerBusy` and
  `controls.ErrAnalyzerRefused`; the survey domain cannot name them
  (`TestTheSurveyDomainDoesNotImportControls`, ADR-0078). Rejected.
- **Make the reset an async job.** It would need no exception, but the
  professor is on a confirmation page waiting to know the scans are gone;
  the call is bounded (it deletes files) and the lock is never waited on.
  The controls made the same trade in ADR-0075 §5. Rejected.
- **Store the confident mark of a doubtful answer.** Saves a click on
  most doubtful answers, and records a mark the student may have tried to
  erase. Rejected — the review shows it pre-checked on a multi, and the
  professor confirms it.
- **Upsert every copy of every report.** Simpler, and it brings every
  resolved item back as pending on the next batch. Rejected (§3).

## Consequences

- `apps/server/CLAUDE.md`'s "one named exception" becomes two; a third
  synchronous worker call needs both properties and an ADR, as before.
- #312 counts only `survey_mark` rows of closed runs; an answer whose item
  was discarded, or never decided, is "sin respuesta" like a blank one.
- A misread the reader was SURE of (a stray mark read `ok`) is stored
  without review, as for a control; the paper check (PAPER-CHECK.md §7)
  is what measures how often that happens.
