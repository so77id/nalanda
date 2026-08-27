# ADR-0052: Controls are soft-deleted and purged through a typed-name confirmation

**Status:** Accepted
**Date:** 2026-08-27
**Decision-makers:** Miguel Rodriguez
**Source:** #261 (archive + restore + purge-with-typing endpoints), prompted
by the 2026-08-27 incident where Miguel had to SSH the Jetson and run
`sudo sqlite3` + `sudo rm -rf` to delete a "control borrar" test control
because there was no HTTP endpoint to do so.

## Context

ADR-0034 §Consequences already set every dependent table's FK on `control`
to `ON DELETE CASCADE`, anticipating that "deleting a control" would one
day be an endpoint. Until #261 the endpoint did not exist, and the
operational cost was a running total:

- Miguel opened SSH to the Jetson (ADR-0038) to remove a test control on
  2026-08-27, using two commands whose composition was a coin-flip about
  which volume held the AMC project directory.
- The alternative — leaving test / broken controls on the list forever
  — was noise the professor navigates around every time they open
  `/controls`.
- A hand-typed URL `/controls/{id}/delete` on the FIRST attempt at an
  endpoint would either need per-professor authorization (the surface has
  none today, see #261 non-goals) or unambiguous confirmation. The
  professor typing the exact name of what they are about to erase is the
  strongest confirmation UI a static form can carry.

The question this ADR answers is what the delete shape looks like on a
surface with no per-professor authz and no undo store, when the operation
is destructive across a whole tree of rows plus files on disk.

## Decision

Delete is a two-step **archive → purge** flow. Archive is a soft delete
that can be reversed by one click; purge is the hard delete gated on
being archived AND on the professor typing the control's exact name.

### 1. Archive is a nullable `deleted_at` column

Migration `00013_control_deleted_at.sql` adds `deleted_at INTEGER` and
`CREATE INDEX idx_control_deleted_at ON control (deleted_at)`. Unix
seconds like every other timestamp in the schema; NULL means active.

`Store.ListControls` filters `WHERE deleted_at IS NULL` — active is the
only shape `/controls` renders. `Store.ListArchivedControls` filters
`WHERE deleted_at IS NOT NULL`, ordered `deleted_at DESC` so the most
recently archived control is on top of `/controls/archived` (the "what
did I just archive" expectation).

`Store.SoftDeleteControl` runs
`UPDATE control SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`
and `Store.RestoreControl` runs the symmetric `WHERE deleted_at IS NOT
NULL`. The `AND` on each is what makes the pair idempotent by guard —
`RowsAffected = 0` → `ErrControlNotFound` rather than clobbering the
timestamp or resurrecting an active row.

### 2. Purge is a three-gate hard delete

The load-bearing invariant is "a hand-typed
`/controls/{id}/purge` on an ACTIVE control must not destroy grades".
Three independent layers enforce it:

1. **Schema:** `Store.PurgeControl` runs
   `DELETE FROM control WHERE id = ? AND deleted_at IS NOT NULL`. The
   `AND` is the belt: even if every higher layer is bypassed by a caller
   that reaches directly into the store, an active row is untouched.
2. **Service:** `Service.Purge` calls `ControlByID` first and returns
   `ErrCannotPurgeActive` if `DeletedAt == nil`. Distinct from
   `ErrControlNotFound` so the handler can render "archívalo primero"
   rather than a bare 404 for a URL against an active id.
3. **Handler:** `handler.Purge` requires `confirm_name == control.Name`
   verbatim — no trim, no case fold. A mismatch re-renders 422 with the
   typed value echoed back and the row untouched. And BOTH
   `PurgeConfirm` (the GET) and `Purge` (the POST) 404 an active row
   before the form renders or the delete is attempted — the destructive
   form never surfaces for anything not archived.

The three gates carry the same rule so no single review misses it. Any
one of them, alone, would already refuse the incident scenario; the two
above it exist because on a small team a review sometimes catches only
the surface-level check.

### 3. Purge is DB-then-files, best-effort on the files

`Service.Purge` sequence:
1. `Store.ControlByID` — the archived check above.
2. `Store.PurgeControl` — DB `DELETE`, `ON DELETE CASCADE` removes
   `control_pregunta`, `copia`, `reading`, `answer`, `annotated_copy`,
   `job`. This is the point of no return.
3. `os.RemoveAll(s.ProjectDir(id))` — the on-disk project directory. A
   filesystem failure here is `WARN`-logged and NOT returned: the DB
   delete already committed, and every referenced grade is already
   unrecoverable through the cascade. Forwarding an `rmdir` failure
   would leave the professor believing the purge failed while the row
   is gone.

Same "best-effort cleanup after the load-bearing commit" pattern as
`PrepareControl`'s `rollback` closure.

### 4. The async runner is untouched by soft-delete

An in-flight `queued`/`running` async job (ADR-0050) on a control the
professor just archived keeps running. Soft-delete only stamps
`deleted_at`; the runner (#249) has no reason to look at the column, and
`MarkRunning`/`MarkDone`/`MarkFailed` still find the row.

A purge on a control with a `queued`/`running` job cascades the job row
too (FK from migration `00012_jobs.sql`). If the runner already picked
it up and is mid-flight, the eventual `MarkDone`/`MarkFailed` will
return `ErrJobNotFound` (issue #257 COR-3) and the runner logs a
warning. No corruption; the professor's intent was to erase everything.

Blocking archive/purge on in-flight jobs is deferred (§Async runner
interaction) — the failure mode is contained and the window is small.

### 5. The archive UI is fricción, not a server-side lock

An archived control's detail page renders a banner ("Este control está
archivado…") with a Restore button; the "Zona peligrosa" section is
hidden. Every other section stays reachable — downloads, review page,
results, stats — so the professor can consult the archived control's
data.

The operational forms (`/scans`, `/reanalyze`, `/close`,
`/copies/{n}/review`) are NOT server-side blocked on an archived
control. The banner is the fricción; adding server refusal to five
handlers would double the policy surface for no user-visible gain (the
professor who reads "está archivado" and then intentionally re-runs
`/reanalyze` is exercising an operator escape hatch, not defeating an
invariant).

## Consequences

- **The two invariants above are `apps/server/CLAUDE.md` rules.** New
  code paths that grow a second delete route (a "delete forever this
  minute" one-step, a bulk purge, a scheduled auto-purge) must respect
  the three-gate purge and the two-step archive discipline. Removing
  any of the three purge gates is forbidden.
- **The five active-only sections of the detail page keep working on
  archived controls.** A future WP that adds a sixth operational form
  MUST NOT server-side-block on archived without discussing here; the
  rule is "banner is enough fricción".
- **No audit log of who archived / restored / purged.** The HTTP
  request log (issue #228) records the POST; per-professor accountability
  is deferred to when the surface grows per-professor authz.
- **No undo of purge.** The word "permanentemente" on the confirmation
  page is a promise: once past the typed name, the row and its files
  are gone. This is the price of not carrying a backup layer for a
  destructive operation whose grades a professor might want to erase.
- **No cron-driven auto-purge.** An archived control persists until a
  professor explicitly purges it. Adding a cron is deferred until there
  is measurable disk pressure — SQLite is cheap and the professor's
  intent to keep an archive is stronger than the cost of a few extra
  rows.

## Related

- ADR-0034 §Consequences — the FK cascades this ADR relies on.
  Amended by this ADR: the "creation is all-or-nothing" rule is joined
  by "delete is a two-step archive→purge with a typed-name gate".
- ADR-0050 §6 — the runner-does-not-notice-soft-delete rule sits next
  to the "worker refusal on the async half leaves the row and files
  intact" rule; both say "the row is authoritative, don't move it on
  transient conditions".
- ADR-0038 — the Jetson is the first live target; SSH-and-`rm -rf` was
  the workaround this WP replaces.
