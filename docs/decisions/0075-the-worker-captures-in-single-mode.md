# ADR-0075: The worker captures in single mode; a re-scanned page replaces its capture

**Status:** Accepted — `apps/server/GMAIL-CHECK.md` on the Jetson outstanding
(a re-read moves published copies between ADR-0073's states)
**Date:** 2026-09-22
**Decision-makers:** Miguel Rodriguez
**Source:** #298, from a production incident on Control 7 (job 27,
2026-09-22), unstuck by hand over ssh. Root cause found by reading AMC 1.6.0's
own Perl on the Jetson; every consequence below re-measured in
`apps/amc-worker/tests/07-rescan.sh`.

## Context

The first batch of Control 7 was scanned wrong — one page per test missing —
so every copy came back `incomplete`. The professor re-scanned properly and
uploaded the full batch. The analyse failed with *"You did not provide the
same number of copies for all pages"*, nothing was captured, and **every
later upload failed the same way** until `capture.sqlite`, `cr/*` and
`scans/*` were moved aside by hand.

The worker ran `auto-multiple-choice analyse --multiple`. That flag is AMC's
**photocopy mode** — "the same printed copy is scanned several times" — and
nothing about Nalanda matches it: every student gets a distinct copy
(`\onecopy{N}`), and `read_capture.py` keys a sheet by copy number and never
read AMC's `copy` column. The flag arrived with the original worker (#142)
and no ADR or document justified it. Three consequences, all measured:

1. **The abort.** Photocopy mode requires every page of a copy to have the
   same number of scans (AMC-analyse.pl, before *"All is OK: we can launch the
   full data capture!"*). A partial batch followed by a full one violates it.
2. **The silent version, which is worse.** When the invariant holds, a second
   scan STACKS beside the first (`copy` 1, 2) and the reader concatenated both
   scans' marks: a copy's RUT came back `[22][00][11][22]…` — every digit read
   twice — `unreadable`, and its ticks `ambiguous`.
3. **The cumulative list.** `getimages --list` does not write a list, it
   EXTENDS one (AMC-getimages.pl reads the file back, puts the new pages first
   and rewrites it). With one shared `scans/list.txt`, every upload
   re-analysed every page ever uploaded, and a failed analyse left its pages
   in the list for the next upload to inherit — which is why the project
   stayed stuck.

## Decision

**1. The worker captures in AMC's single mode, one batch at a time.** No
`--multiple`: every page is captured at `copy = 0`, and a page captured again
is OVERWRITTEN (AMC bumps `capture_page.overwritten`). Each batch gets its own
page list, `scans/list-<batch>.txt`, so a run sees exactly the PDF just
uploaded. A second upload therefore **replaces** what it re-scans and **adds**
what it does not, and a failed one leaves nothing behind for the next.

**2. The report says what this batch did.** `/analyse` snapshots the capture
before and after AMC runs and adds an optional `batch` field — pages captured
(new or overwritten), pages AMC could not place, copies re-captured
(ADR-0031 §Amendment). The server fails the job on `batch.captured == 0`.

**3. A re-captured copy is born again** (ADR-0048 §Amendment): its
corrections go on both sides of the seam — AMC's `manual` column and the
server's override rows — along with its annotated PDF, and its publication
record stays, so ADR-0073 derives it `stale` when its grade moved. The
analyse job says how many published copies were re-read (a `jobs.Notice`,
ADR-0050 §Amendment); it does not refuse them.

**4. The reader refuses a photocopy-mode capture.** A capture holding any
`capture_zone.copy > 0` box — every project captured before this ADR may —
is refused like an unscored one: nothing on stdout, exit 2, the repair named.
The worker never produces one again; the reader will not read one silently.

**5. The professor can start over from the backoffice.** "Borrar escaneos"
is a destructive-confirm pair (ADR-0052's shape): the worker empties
everything a capture produced (`POST /scans/reset`) FIRST, and only then the
server drops the control's readings, annotated rows and publication stamp
and returns it to `generated`. The layout and `inputs/` stay — the paper
students wrote on was printed from them. The reset is **synchronous**, under
its own 25 s deadline, as a bounded call the professor waits on (the rule
ADR-0050's #271 amendment states) rather than an analysis-class one — and it
never waits on the worker: the client's lock is one mutex for every control,
so the reset refuses at once (409, `ErrAnalyzerBusy`) when another control's
job holds it, and the handler refuses (409) while this control's own job is in
flight. Those two refusals depart on purpose from the fourth rule of
`add-a-backend-endpoint.md` (#287: flash + 303, never a 4xx, and a jobs-store
read failure counts as "not in flight"): the route is a destructive-confirm
pair whose other refusals are status pages too, and the rule's fail-open was
weighed for a send the professor can repeat — a wipe racing this control's own
analyse cannot be undone, so a read failure here fails CLOSED.

## What this moves, measured

- **The loud failure on unrecognised pages moves from AMC to us.** It lived
  inside the photocopy block; in single mode AMC files an unplaceable page in
  `capture_failed` and exits 0. Point 2 is what keeps a useless batch from
  ending green.
- **A batch from ANOTHER Nalanda control is not an unrecognised batch.** The
  issue assumed it would be. It is not: every control prints the same page
  markers (`+1/1/60+` for copy 1 page 1, measured identical under two
  different `\AMCrandomseed` values), so AMC reads a foreign page as this
  control's copy of the same number and — in single mode — overwrites it,
  resetting that copy's corrections. Photocopy mode would have stacked it
  instead. Nothing in the capture tells two controls apart; the repair is
  uploading the right batch (which replaces again) or resetting the scans.
  Detecting it would need a control-specific mark on the sheet — see
  §Consequences.
- **AMC can drop a page and still exit 0.** Its parallel analyse processes
  each write `capture.sqlite`; when a write fails it logs `SQL ERROR`, loses
  the page — neither captured nor in `capture_failed` — and exits 0. Measured
  on a macOS bind mount in the #298 review (3 of 10 fresh captures; 0 of 20
  on the container's filesystem). The worker now refuses a batch whose
  analyse logged one, so a lost page is a failed job the professor re-uploads
  rather than an `incomplete` copy with no reason.
- **TRAP 1 inverts** (ADR-0030 §Amendment). The capture's copy index is now 0,
  so `association --set --copy 1` — the literal the wrapper hardcoded — is the
  ghost. The wrapper reads the index off the capture.

## Alternatives considered

- **Keep photocopy mode and teach the reader the `copy` column.** Rejected:
  the mode means "the same copy scanned several times", which never happens
  here, and choosing between stacked scans is a decision nobody could make
  correctly — the newest is not always the right one.
- **Refuse a re-read over published copies.** Rejected: it would force an
  unpublish of the whole control to fix one sheet, the coarser tool ADR-0073
  retired. The copy goes `stale` and the professor is told.
- **Per-page or per-copy upload.** Out of scope: the unit stays the batch PDF.
- **Reset without the worker, from the server's side of the volume.**
  Rejected: the worker owns every write inside `/work`, and calling it first
  is what makes a stale worker (the two CD workflows drift) harmless — it
  answers 404 before anything is destroyed.

## Consequences

**Positive:** a re-scan is the operation a professor expects it to be; a bad
batch no longer bricks a control; the one exit that used to need a shell is a
button; and each run costs its own batch, not the project's history.

**Negative / trade-offs:**
- **A project captured before this ADR is refused**, not read, the next time
  it is analysed or re-read. Its repair is "Borrar escaneos" and a fresh
  upload — the price of never reading a stacked capture silently.
- **A wrong control's PDF is overwritten in silently** (above). Accepted for
  one professor on one class at a time; revisit if controls start sharing a
  scanning session.
- **A lost report outlives its reset.** If the worker re-captured copies and
  cleared their `manual` column but the server never persisted the report (a
  restart mid-job, a store failure before the upsert), the server's override
  rows survive and the next save of that copy re-applies them to the new
  image. A re-read does not repair it — only an upload that re-scans the same
  copies does. Named rather than engineered around (a worker-side pending-
  reset record was the alternative).
- **The deploy window.** The server merges first and its CD is minutes; the
  worker's is ~30. Every wire addition degrades to today's behaviour, and the
  reset 404s before destroying anything. One case is uncovered: a re-upload
  over manually corrected copies INSIDE the window — the new server drops its
  overrides while the old worker leaves `manual` set. Named, not engineered
  around: single professor, one window per deploy.

## Review triggers

- An AMC upgrade that changes single-mode overwrite semantics
  (`capture_page.overwritten`, `get_zoneid` re-using rows): `07-rescan.sh`
  performs both and says which moved.
- A second control scanned in the same session, or a report of a foreign
  batch overwriting copies: that is when a control-specific mark on the sheet
  earns its cost.

## References

- ADR-0030 (the engine and its traps), ADR-0031 (the report contract),
  ADR-0048 (the manual channel), ADR-0050 (the runner), ADR-0052 (the
  destructive-confirm pair), ADR-0073 (per-copy publication).
- `apps/amc-worker/worker.py` — `analyse`, `forget_corrections`,
  `reset_scans`, `scan_copy`; `read_capture.py` — `capture_snapshot`,
  `batch_outcome`, `check_single_capture`.
- `apps/server/internal/domain/controls/scans.go` (`AnalyzeBatch`) and
  `reset.go` (`ResetScans`).
- Issue #298 — the incident, the design and the acceptance criteria.
