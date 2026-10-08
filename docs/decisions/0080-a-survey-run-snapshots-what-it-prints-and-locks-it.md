# ADR-0080: a survey run snapshots what it prints and locks what it printed

**Status:** Accepted
**Date:** 2026-10-05
**Decision-makers:** Miguel Rodriguez
**Source:** epic #308, WP-2 #310 (S2–S6, review Round B); the run-model ADR
that ADR-0078 §Consequences deferred to this WP. The job queue the runs
need is ADR-0079's.

## Context

A survey (ADR-0078) is a bank of questions. The professor applies it more
than once a semester — beginning, middle, end — and the point of applying
it again is to compare: did "¿Entiendes la recursión?" move between March
and June. A comparison only means something over the SAME wording, the
same alternatives and the same order, yet the bank is something the
professor keeps editing between semesters. And a printed sheet cannot be
edited at all: once 30 copies are on the desks, the run IS what was
printed.

The sheet itself is read by Auto-Multiple-Choice, which is built for graded
exams with a student-ID grid. A survey has neither a grade nor an ID.

## Decision

1. **A run snapshots what it prints.** Creating a run writes
   `survey_run_question (run_id, question_id, printed_number)` for every
   question in the bank, in print order, inside the transaction that
   inserts the run and reads the bank (`surveystore.CreateRun`). That table
   is the contract the reading (#311) and the results (#312) consume: a
   run's answers are keyed by question id, and a question missing from a
   run's snapshot shows as "—" in a comparison. The question TEXT is not
   copied: the lock (§2) keeps it identical for as long as a run holds it.
2. **A run locks the questions it printed; the bank stays append-only.**
   While a survey has a run that is not cancelled (`Run.LocksBank`), editing,
   deleting or moving an existing question fails with `ErrBankLocked`.
   Adding a question stays allowed — it simply was not in the earlier runs.
   The check runs inside the write transaction (`requireUnlocked`, after
   `touch()`), so it cannot race a concurrent `CreateRun`; the schema
   backs it with a foreign key from `survey_run_question.question_id` that
   has no `ON DELETE` clause, so a printed question cannot be deleted under
   a live run even past the domain.
3. **Print order: context questions first.** `PrintOrder` puts every
   context question (the ones results filter by: section, campus, "¿repites
   el ramo?") first, in bank order, then the rest in bank order. That order
   fixes `printed_number`, the number on the paper.
4. **A run's own state is separate from its jobs'.** A run is `open`,
   `closed` (frozen by the professor, #311) or `cancelled`. Generating the
   PDF and reading the scans are JOB states (ADR-0079), shown by the run
   page's banner and its "PDF: listo / en curso / falló / no encolado"
   line; "reviewing" is derived from the review queue, never stored.
5. **Cancelling releases the lock and drops the snapshot.** Only an open
   run is cancelled (`ErrRunNotCancellable`); the handler refuses while a
   job about the run is in flight, and #311 adds "nor once it has scans".
   A cancelled run printed nothing anyone will read, so it holds nothing:
   its `survey_run_question` rows are deleted with the state change
   (#310 review, COR-1), which is what lets a question only it printed be
   deleted. The run row stays, numbered, so "Pasada #2" never comes back as
   a different run.
6. **A run whose source cannot be written cancels itself.** `CreateRun`
   commits the run, then writes the AMC source; if that write fails,
   nothing was or can be printed, and the run is cancelled rather than left
   open and locking the bank.
7. **Runs are cancelled, never purged, in v1.** No route hard-deletes a run.
   ADR-0079 §5's "nothing orphans a run's jobs" rests on this; a purge that
   arrives later (#313) inherits the job-deletion duty `PurgeControl` has.
8. **A survey rides AMC's graded path.** The sheet has no `\namefield` and
   no `\AMCcode`; every simple question carries exactly ONE stand-in
   `\correctchoice` (its first alternative) because AMC refuses a question
   with zero or all answers correct ("0/3 good answers not coherent"), and
   every multi-select carries none. AMC computes a score; nothing reads it.
   With no ID grid, every copy reads `rut_status: unreadable` and lands in
   `needs_review` (measured, S0, `apps/amc-worker/tests/08-survey.sh`), so
   the survey reader (#311) keys on each ANSWER's status — ok, ambiguous,
   doubtful, blank — and never on the copy's.

## Alternatives considered

- **Versioned or copy-on-write questions** — editing a printed question
  creates a new version, and runs point at versions. It would let the
  professor fix a typo after printing, but a comparison across versions is
  exactly the meaningless comparison this decision exists to prevent, and
  it doubles every read. Rejected for v1.
- **Freeze the whole bank** once a run exists. Simpler, but the second run
  is the moment a professor wants to add the question they forgot; nothing
  about appending invalidates an earlier run. Rejected.
- **Copy the question text into the run.** Makes each run self-contained,
  but then two runs may hold different wording under one question id, and
  the comparison silently compares them. The lock is what makes the id
  mean the wording. Rejected.
- **Keep a cancelled run's snapshot.** It would record what a cancelled
  run would have printed, but it keeps the bank locked by a run that will
  never be read — the professor would have to delete the run to fix a
  typo. Rejected (#310 review, COR-1).
- **A fork of AMC's ungraded path, or our own OMR.** AMC has no survey
  mode; the stand-in answer is two lines of TeX against a reader that is
  already proven on these sheets (S0). Rejected.

## Consequences

- #311 and #312 may rely on: a non-cancelled run's snapshot never changing,
  the question text of a snapshot entry never changing while that run is
  not cancelled, the AMC question name `q<id>` (`tex.QuestionName`) being
  the snapshot's question id, and `printed_number` being the number the
  student saw.
- Fixing a typo in a printed question means cancelling every run that
  printed it — possible only before scans — or adding a corrected question
  and leaving the old one. That is the price of §2, and it is visible in
  the UI: the bank page says why an edit is refused.
- The score AMC computes is noise; any future feature that reads a survey
  score is reading the stand-in answer.

## Not yet proven

- **The survey sheet on paper.** Every survey read so far was filled
  synthetically (`08-survey.sh`). `apps/amc-worker/PAPER-CHECK.md` §7 is the
  check; until it runs against a printed run, this line stays here, and
  its verdict replaces it.
