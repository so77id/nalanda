# ADR-0079: the job queue serves more than the controls — one runner, a polymorphic subject

**Status:** Accepted
**Date:** 2026-10-05
**Decision-makers:** Miguel Rodriguez
**Source:** epic #308, WP-2 #310 (S1); amends ADR-0050

## Context

ADR-0050 gave the controls an in-process, single-goroutine job runner for
the minutes-class AMC work, persisted in SQLite. Its table was born owned by
the controls: `job.control_id TEXT NOT NULL REFERENCES control(id) ON DELETE
CASCADE`, and `jobs.Handler` took a `controlID`.

The survey subsystem (ADR-0078) has the same class of work: a run's PDF is a
`/generate`, its scans an `/analyse` (#311). Both must be async —
`apps/server/CLAUDE.md` forbids calling `amcworker.Client` from the request
goroutine — and both contend for the same worker client, whose one mutex
serialises every AMC call.

## Decision

1. **One queue, one runner, a polymorphic subject.** `job.control_id` becomes
   `subject_kind` (`control` | `survey_run`) + `subject_id`
   (`00023_job_subject.sql`). The runner, the Sweep pass, the banner and
   the dismiss route are unchanged in behaviour.
2. **The subject kind is derived from the Kind, never chosen by a caller.**
   `jobs.Kind.Subject()` maps every controls Kind to `control` and every
   survey Kind (`survey_generate` now, `survey_analyse` in #311) to
   `survey_run`. `Submit(ctx, subjectID, kind, payload)` keeps its shape,
   and a job cannot be filed under the wrong subsystem. The column is
   still stored, so "the latest job on this subject" is one indexed lookup
   (`idx_job_by_subject`) that cannot mistake a control id for a run id
   that happens to be spelled the same.
3. **The store's reads are subject-generic.** `LatestForControl` became
   `LatestForSubject(ctx, subjectKind, id)`, and `LatestForControlByKind`
   became `LatestByKind(ctx, id, kind)`.
4. **A survey Kind's handler factory lives in the survey domain**
   (`internal/domain/survey/jobhandlers.go`), never in `controls` — the
   "four places" rule in `apps/server/CLAUDE.md` now says *the owning
   domain's* `jobhandlers.go`.
5. **The foreign key and its cascade are gone.** A column that points at
   two tables cannot carry a `REFERENCES`. `controlstore.PurgeControl` now
   deletes the control's jobs in the same transaction as the guarded
   `DELETE FROM control` (pinned by the purge test). A survey run is never
   hard-deleted in v1 (ADR-0080 §7), so nothing orphans its
   jobs; the purge that one day arrives inherits this obligation.

## Alternatives considered

- **A second queue and runner for surveys** (`survey_job` + its own
  goroutine). It would leave the controls' code untouched, but two
  goroutines would contend for the worker client's mutex. ADR-0050 made the
  runner single exactly so that AMC work queues in ONE place, with one
  banner, one Sweep and one failure policy. Rejected.
- **A nullable `run_id` column beside `control_id`**, each with its own
  foreign key and a CHECK that exactly one is set. Rejected: it keeps both
  cascades, but every query grows an `OR`, the index doubles, and a third
  subject would mean a third column. The subject pair is what the queue
  actually is.
- **Calling the worker synchronously for surveys.** Ruled out by the
  standing rule (`apps/server/CLAUDE.md`, ADR-0050): a 53 s `/analyse`
  exceeds every proxy and browser idle timeout.

## Consequences

- One migration rebuilds `job`. It is a CHILD table (`job.control_id →
  control.id`), so the `DROP` cascades nothing. The two older
  rebuild/cascade tests are now scoped to the migration they pin
  (`migrationsUpTo(t, "00023")`), and
  `TestTheJobSubjectRebuildKeepsEveryControlsJob` pins this one.
- Losing the cascade moves one duty into code (§5). It is the kind of rule
  a later "simplification" drops, which is why a test holds it rather than
  this paragraph.
- ADR-0050's single-writer reasoning now covers the surveys too: a survey
  run's generation queues behind a control's analysis, and the reverse.
