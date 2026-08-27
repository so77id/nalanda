# ADR-0050: The controls runner is in-process, single-goroutine, and does not retry

**Status:** Accepted
**Date:** 2026-08-27
**Decision-makers:** Miguel Rodriguez
**Source:** #249 (async job runner for the four minutes-class AMC operations),
prompted by the 2026-08-27 incident where a `/reanalyse` on Control 2 took 83 s
and Tailscale funnel returned 502 to the browser before the server finished
successfully (`project_issue243_shipped.md` §"502 en Tailscale funnel").

## Context

Every operation `apps/server` runs against `apps/amc-worker` is minutes-class.
`/generate` takes 10–30 seconds. `/analyse` is minutes for a real batch.
`/reanalyse` is 10–90 seconds and the 83-second case above tripped the
Tailscale funnel's proxy timeout — the server finished the work, but the
professor saw a 502 and did not know if it worked. The per-copy `/annotate`
loop runs seconds–minutes and ADR-0048 §Consequences explicitly deferred an
async version to a follow-up.

Before this WP the four operations blocked the HTTP request. The professor
watched a white progress bar for the duration; a proxy timeout looked like a
failure that was actually a success; the annotate loop after `/analyse` ran
in a bare goroutine detached from any DB representation, so a server
restart mid-batch left the professor with no signal of what got done. The
UX cost is real (spurious 502s, no visible state) and the operational cost
compounds it: on the Jetson (ADR-0038) Watchtower restarts on every CD
push, several times a week, and any in-flight work at the moment of that
restart vanishes without a trace.

The question this ADR answers is what a durable async shape looks like on a
server that ADR-0034 committed to running as a single instance with no
outside dependencies.

## Decision

An in-process job runner, wired at `cmd/server/main.go` between the
controls service and the HTTP surface, with SQLite as the durability
substrate.

### 1. One goroutine, one queue, one job at a time

`internal/domain/jobs.Runner` reads from a buffered channel and dispatches
one handler at a time. Not a worker pool, not a per-Kind queue: one
goroutine. The point is the single-writer invariant against AMC — its
project state is a SQLite file the worker container mutates, and running
two `/analyse` calls against the same project would corrupt it. The mutex
inside `amcworker.Client` (`generateLock`) already provided this at a
lower level; the runner promotes it to the level above so any future sync
caller that skips the runner still has the mutex as belt-and-braces.

The buffered channel (`runnerBuffer = 256`) absorbs bursts of submissions
without blocking the HTTP handler. Overflow does not lose work: the row
is `queued` in the DB and `drainStore` after every completed job re-scans
for stragglers.

### 2. Every job is a persisted row before it runs

Migration `00012_jobs.sql` creates the `job` table. `Runner.Submit`
INSERTs the row with `status = 'queued'` BEFORE pushing to the channel.
Handlers move it through `running` → `done` | `failed` with explicit
`WHERE status = ?` guards (see §5). The `payload_json` column carries
whatever the handler needs; two of the four kinds (`generate`,
`annotate`) carry `{}` because their async methods re-read the control
row for what they need.

The set of Kind values is closed: `generate`, `analyse`, `reanalyse`,
`annotate`. The set is enforced twice — the SQLite `CHECK (kind IN
(...))` on the column, and the `jobs.ValidKinds` slice in Go — because a
runtime typo satisfying one side without the other silently drops a
whole class of work. Adding a Kind requires a paired migration.

### 3. Boot-time Sweep, not retry

`Runner.Sweep` runs ONCE from `main.go`, BEFORE `go runner.Start(ctx)`.
Two passes:

1. Every row in `status = 'running'` is flipped to `failed` with
   `error = 'server_restart_mid_job'`. The previous server died before it
   could mark the row terminal; automatic retry would silently redo work
   the professor cannot see, and the failure surface (the banner) is
   where a human decides what to do.
2. Every row in `status = 'queued'` is re-pushed to the channel. Those
   rows were committed but never picked up, so the runner picks up where
   it left off.

No automatic retry of `failed` rows. The professor dismisses via `POST
/jobs/{id}/dismiss` and re-submits from the form; a future WP may add an
explicit "Regenerate" button.

### 4. Handlers register at boot, panic on missing

`jobs.NewRunner` demands a handler for every entry in `ValidKinds`. A
missing or `nil` entry panics at boot, matching the rest of the app's
`NewService` / `NewControls` / `NewAuth` "wiring mistake is a boot
panic" rule (`backend-code-style.md` §Errors). Adding a Kind therefore
lands in four coordinated places:

1. A new `jobs.Kind` constant + `ValidKinds` entry
   (`internal/domain/jobs/jobs.go`)
2. A migration extending the `job.kind` CHECK enum
3. A `controls.NewXHandler` factory
   (`internal/domain/controls/jobhandlers.go`)
4. Its registration in `cmd/server/main.go`'s `jobs.Handlers` map

The panic-at-boot catches any of the four being missing.

### 5. `WHERE status = ?` guards on Mark\*

`jobstore.MarkRunning` / `MarkDone` / `MarkFailed` each guard the FROM
state in the WHERE clause (`queued` → `running`, `running` → `done`,
`running` → `failed`). The single-goroutine invariant makes concurrent
transitions impossible today, but the guard turns any future accident
(a second `go Start`, an ops tooling call) into a loud
`ErrJobNotFound` instead of silent status corruption. The next
`Mark*` variant copies this shape.

### 6. Row + files survive a worker refusal (atomicity reversal)

ADR-0034 §Failure modes described `Service.Create` as all-or-nothing:
"the row is committed AND the files are on disk, or neither". This WP
splits `Create` into `PrepareControl` (sync, atomic) + `GenerateAssets`
(async, worker call), and `UploadScan` into `SaveUploadedBatch` (sync,
atomic file write) + `AnalyzeBatch` (async, worker call). The atomicity
promise still holds on the SYNC halves. On the ASYNC halves,
`GenerateAssets` and `AnalyzeBatch` deliberately leave the row and files
intact on any refusal. The reasoning: `source.tex` and `pool.json` are
the professor's authored artefacts, and rolling them back on a transient
outage would force the professor to re-choose the pool.

ADR-0034 is `Amended by:` this ADR for the atomicity clause. `apps/server/CLAUDE.md`
carries the operating rule so an agent editing the runner doesn't paper over it.

## Alternatives

**Worker pool of N goroutines.** Rejected because AMC's per-project
SQLite state is a single-writer resource and N > 1 would need a
per-project mutex to stay correct — the same lock we already have inside
`amcworker.Client`, just further out. N = 1 is the honest name for what
the single-writer invariant requires.

**External queue (Redis, RabbitMQ, Cloud Tasks).** Rejected on
dependency ceilings. `go.mod`'s direct set is `modernc.org/sqlite` and
`github.com/pressly/goose/v3` on purpose (ADR-0034). Redis adds a
second stateful process to a Jetson we already keep austere; RabbitMQ
adds one more thing that can be down when Watchtower restarts the
compose stack. Neither buys anything a durable SQLite queue does not.

**Cron-poll the DB without a channel.** Rejected because it trades a
notification (`ch <- id` after INSERT) for a poll interval, and any
polling interval is either latency or wasted work. The channel + drain
combination gets the latency of the notification for the happy path and
the durability of the poll for the recovery path.

**Automatic retry of `failed` rows.** Rejected because AMC failures are
mostly professor-visible (a bad scan, an inverted threshold, a paper
size mismatch), not transient. Silent retry of a failed job would repeat
the same failure at cadence with no signal until the professor visits.
The banner is where a human decides what to do next.

**Retry `running` rows on boot instead of failing them.** Rejected for
the same reason and one more: two-phase commit between "start the
handler" and "confirm we started it" is fragile against Watchtower's
container kill window. A "was running, now failed with
server_restart_mid_job" state is honest about the ambiguity.

## Consequences

**Atomicity boundary moves.** The sync halves are atomic; the async
halves preserve state on refusal. ADR-0034 §Failure modes' `Create`
promise is now scoped to `PrepareControl`. The reversal is in
`apps/server/CLAUDE.md` §Rules for Claude and in each Service method's
docstring.

**Single-instance operational constraint compounds.** ADR-0034 already
required a single server instance (migrations at boot, no lock table).
The runner adds a second reason: two runners over one SQLite would race
on `MarkRunning` (the WHERE guard catches it, but the loser would burn
the handler's work). Adding a replica is now a decision that reopens
BOTH constraints.

**Watchtower restart is visible.** A restart mid-`analyse` leaves the
job `failed` with `error = 'server_restart_mid_job'` on the banner. The
professor decides whether to re-upload; the operator sees the marker in
`job.error` for post-mortem.

**No new dependency, no new port, no new container.** `go.mod` is
unchanged and no service was added to `infra/local/docker-compose.yml`.
The Jetson deploy shape (ADR-0038) does not change.

**Buffer size 256 is a magic value with a comment.** The buffer sits
between Submit and Start. If it fills, `drainStore` after every
completed job picks up the queued rows. 256 is comfortably above any
realistic teacher-burst (a class of 30 copies produces ONE upload, not
30 jobs). The rejected alternative (unbuffered channel) makes Submit
block on runner idleness, coupling the HTTP handler to it.

**The `WHERE status = ?` guard is the pattern the next Mark\* copies.**
Any future async subsystem in this app (a Canvas grade poster in WP-G,
an email reminder queue) inherits: closed-set Kind + CHECK enum + typed
Payload + panic-at-boot registry + `WHERE status = ?` on state
transitions.

## Review triggers

Revisit this ADR when:

- A second async subsystem lands. If the shape stabilises, promote it
  into `docs/standards/backend-code-style.md` §Queue-persisted
  subsystems (currently pattern-only; see #249 review DCO-6).
- A course scales past what one runner can chew through. The 30-copy
  batches this ADR sizes for are far from the runner's ceiling; if a
  class grows to hundreds, N > 1 needs a real answer.
- Watchtower churn forces a rethink of `server_restart_mid_job`. If a
  common restart is minutes rather than seconds, an explicit retry
  policy or a state-machine step may become worth the complexity.
- The `apps/amc-worker` mutex is removed. Belt-and-braces at two levels
  makes sense as long as both are cheap; if the worker layer changes,
  the runner's single-writer invariant becomes the only one holding.

## References

- Issue #249 §Design, §Problem, §Non-goals
- ADR-0034 (backend born) — the atomicity clause this ADR amends
- ADR-0048 (annotate PDF) — §Consequences "async is a follow-up if
  courses grow" is what this ADR discharges
- ADR-0038 (Jetson + Watchtower) — the operational surface that made
  Sweep-on-boot necessary
- `apps/server/internal/domain/jobs/{jobs.go,runner.go}`
- `apps/server/internal/infra/storage/jobstore/jobstore.go`
- `apps/server/migrations/00012_jobs.sql`
- `apps/server/internal/domain/controls/jobhandlers.go`
- `apps/server/cmd/server/main.go` §"the async job runner"
