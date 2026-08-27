# ADR-0032: The published question bank is the contract

**Status:** Accepted
**Date:** 2026-08-16
**Amended:** 2026-08-25 — page-only annotations (`<Explanation>`) are permitted authored content that deliberately does NOT enter the bank; see §Amendment.
**Amended:** 2026-08-27 — the "Recargar banco" button moves from the backoffice top bar to the `/controls` index; the endpoint is unchanged; see §Amendment — 2026-08-27.
**Decision-makers:** Miguel Rodriguez
**Covers:** the shape of `questions.json` as the `apps/web` → `apps/server`
contract · the join key from a printed sheet to a grade · why one authored
question is read by two readers, and what holds them in agreement
**Source:** Issue #139 (WP-B: the question bank), design `2026-08-controles.md`
C1/C2/C6/C14/C16. The downstream half of the same join is ADR-0031.

## Context

`apps/web` builds a control question bank out of `content/` and publishes it as
`questions.json`. A future `apps/server` reads that file over HTTP to generate a
printed entrance control, which is scanned and graded by `apps/amc-worker`.

The design narrative already closed the transport question (`2026-08-controles.md`
C14: publish an artifact rather than mount the repo beside the server, so the
server can never generate a control from a question the site does not show). What
it did not record is the artifact's SHAPE — and that shape is what the server
will be written against.

ADR-0031 exists for the mirror reason at the other end of the same join: *the
reading report is the contract*. It was split out of ADR-0030 on the reversal
test — a decision that survives the reversal of the ADR it is filed under is
filed under the wrong ADR. The bank passes that test in the other direction:
replace the Vite plugin, the MDX reader, or `apps/web` itself, and this shape is
still what `apps/server` binds to.

## Decision

**`questions.json`, at the site root, is the contract between `apps/web` and
`apps/server`.** It carries:

- `version`, so a shape change is a visible, breaking one.
- `documents`, **in `index.yaml` reading order**, each with its **section slugs
  in document order**. This is what resolves "from section X to section Y" into
  a pool without the server parsing a single `.mdx`.
- `questions`, each with: the authored `id`, its document, its `anchor` (or
  `null`), the derived `type`, the statement, the listing as **its own field**,
  the alternatives, and `correct` as an **index SET** into them.

Four properties are load-bearing:

**The `id` is the join key**, hand-written and stable. It travels into the
generated `.tex`, comes back from the worker as `answers[].name`, and lands in a
grade (ADR-0031). Deriving it fails both ways — anchor-plus-ordinal renumbers
when questions are reordered, a hash of the statement changes when a typo is
fixed.

**`correct` is a set of indices, and the shuffle happens downstream.** Every copy
shuffles its alternatives at print time (C6), so these indices index the AUTHORED
order and nothing else. A consumer that assumes printed order is wrong.

**The listing is a separate field** because the generator writes it to its own
file and the sheet reads it with `\lstinputlisting`, which needs no escaping at
all — braces, backslashes, `$`, `%`, `_` and `#` travel literally from the `.mdx`
to the printed page. Inline in the `.tex` every one of them would have to be
escaped, and a Java program is mostly braces. Measured: `verbatim` inside an AMC
question does not compile at all.

**Documents off the teaching path are skipped**, not appended. A control covers a
range of the reading order, so a document with no position in it has no range to
belong to and its questions would be unreachable by definition.

**The derived `type` originates here.** A question is `multiple` when more than
one alternative is marked, derived from the marks and never declared — a `type`
prop would be a second source of truth able to disagree with the checkboxes the
reader sees. ADR-0031 (as amended by #147) has the worker READ a type back from
AMC's scoring tables; that value is the echo, this one is the origin.

### Two readers, one gate

A question is read twice, on purpose: `content/questionSource.ts` reads the MDX
SOURCE for the gates and the artifact, `lib/questions.ts` reads the RENDERED tree
for the page. One reader cannot serve both — `import.meta.glob` with `?raw`
returns the COMPILED module here, because the MDX plugin claims the file first.

They are held in agreement by `app/questionReaders.test.tsx`, which renders every
published document and compares them. That gate is not decoration: four
divergences were shipping when it was written, and the worst was student-facing —
blank lines between alternatives make markdown emit a loose list, and every
alternative then read as incorrect, so a student marking the right answer was
told they were wrong.

**Consolidation trigger** (the shape ADR-0029 §3 uses): if MDX ever becomes
compilable at build time cheaply enough to emit the bank from the rendered tree,
one reader replaces two and this gate retires with them. Not before — and a
reviewer proposing the merge should read this section first.

## Alternatives considered

**Serve `content/` and parse MDX in Go.** Rejected by C14: it ties the deploy to
a checkout and lets the server and the site drift.

**One artifact per document.** Rejected: a control resolves a RANGE, so the
consumer would fetch and stitch an unknown number of files to answer one
question. The reading order is exactly what the single file exists to carry.

**`correct` as alternative ids or letters.** Rejected: letters are positional and
every copy shuffles, and ids on alternatives would be a second identifier to keep
stable for no gain.

**Deriving the question id.** Rejected — see above; both derivations fail the one
requirement the id exists for.

## Consequences

- **A schema change is a cross-app breaking change.** That is what `version` is
  for, and why the shape is here rather than in a docstring.
- **A duplicate question id fails the BUILD**, deliberately unlike the rest of
  the gate ladder. ADR-0029 §7 sets the rule — a content defect blocks
  publishing, not writing — and this is the exception: the id is the join key,
  and a duplicate silently merges two students' answers into one column. Do not
  harmonise it down to a suite gate.
- **The correct answers are published.** Consistent with C1 (the bank is study
  material and the page reveals answers anyway) and recorded as an accepted risk
  with its own review trigger in `docs/security-notes.md` — the two records
  govern one lever and neither may be reversed alone.
- The section spine the artifact carries is produced from the SOURCE, which
  ADR-0021 had rejected. See that ADR's amendment.

## Addendum — 2026-08-26 — the server refreshes the bank in place (issue #230)

**Context.** Until this WP, `apps/server` read `questions.json` once at boot
and never refreshed it: a redeploy of `apps/web` left the server serving the
pre-publish snapshot until an operator restarted the container. The
first-reported symptom (2026-08-26) was that a new control's picker did not
show two just-published Complejidad chapters — the site had 9 documents / 84
questions, the server still held 7 / 66. `docker-compose restart server` on
the Jetson fixed it in ~30 seconds; that path is invisible to the professor,
racy with in-flight requests, needs SSH, and does not scale as Miguel
publishes more content.

**Decision.** The server refreshes its in-memory bank on a schedule, with a
manual admin button as an escape hatch. Both paths call one method
(`bank.LiveBank.Reload`) that swaps an `atomic.Pointer[Bank]`; a reader
holding a `*Bank` captured before a swap keeps seeing the previous snapshot,
so the rotation is safe against every concurrent request without locking the
read path.

- **Cadence.** 5 minutes, configurable via `NALANDA_BANK_REFRESH_INTERVAL`.
  Matches the Watchtower poll cadence on the Jetson (ADR-0038) so the server
  refreshes at the same rhythm as the container image itself updates. `0s`
  disables the ticker, and then the manual button is the only refresh path.
- **Conditional GET.** Every refresh cycle after the first sends
  `If-Modified-Since` derived from the previous response's `Last-Modified`;
  the server answers `304` when the artifact has not moved, and `Reload` is
  a no-op (`DEBUG` line only). A real update logs `INFO` with document and
  question counts, so an operator grepping the logs can tell one boot from
  the next.
- **Failure preserves the snapshot.** A network flap, a 5xx, a malformed
  publish — none may nil the current bank. `Reload` logs `WARN` and returns
  an error; the server keeps serving the last known good snapshot. Reintroducing
  a code path that clears the pointer on failure is forbidden — the same rule
  §Rules for Claude carries for the uploaded scan batch after issue #210, for
  the same reason.
- **Manual escape hatch.** `POST /admin/bank/refresh` (session-gated, CSRF-
  verified) triggers an immediate `Reload` and flashes the outcome in
  Spanish. A "Recargar banco" button in the backoffice top bar posts to it;
  the professor stays on the page they clicked from when the `Referer` shares
  scheme+host with `NALANDA_PUBLIC_URL`, or lands on `/controls` otherwise
  (an off-origin Referer never steers the redirect). *(Amended 2026-08-27 —
  the button moved to the `/controls` index; see §Amendment — 2026-08-27.)*

### Alternatives considered

- **GitHub Actions webhook** on `apps/web` publish, targeting the server's
  own endpoint. Rejected: the Jetson deploy sits behind Tailscale (ADR-0038),
  and exposing a public webhook target for GitHub to hit adds a security
  surface and infra coordination cost. The ticker + `If-Modified-Since` is
  cheaper (most polls are a ~200-byte 304), robust to infra changes on either
  side, and stays inside the Tailscale boundary.
- **Watchfile / inotify on a mounted repo.** Rejected — ADR-0032 §C14 already
  closed transport as "publish an artifact, never mount the repo". The
  webhook alternative is what this addendum weighs against; a mounted repo is
  a shape this decision continues to refuse.
- **Partial reload of one document.** Rejected: a bank swap is atomic
  (`atomic.Pointer[Bank]`), and a per-document diff would need a merge policy
  the current shape does not have. The whole bank fits comfortably in memory;
  swapping the pointer is cheaper than reconciling.
- **Persisting the last-good snapshot to disk between boots.** Rejected: the
  source of truth is GH Pages, and re-fetching on startup is fast (`FetchTimeout`
  is 30s, the file is kilobytes). Persisting adds a second cache to keep in
  sync for no measured benefit.

### Consequences

- **The reader is now a lifecycle, not a one-shot.** Callers hold a
  `*bank.LiveBank` rather than a `*bank.Bank`; every consumer resolves the
  current snapshot with `.Get()`. The atomicity guarantee is
  **per-call**, not per-request: a handler that validates in one `.Get()`
  and then hands the request to the service, which resolves another
  `.Get()`, can straddle a swap. The failure mode is small (a picker
  validation against snapshot A followed by a pool draw against snapshot
  B) and no worse than any other read against a slowly-changing store;
  the WP review of #230 (IMPORTANT-3) pinned the distinction so future
  readers do not confuse per-call atomicity with request-level
  consistency. The static shim `bank.NewStaticLive(*Bank)` covers tests
  that hand a fixed bank into constructors that now take the live
  wrapper.
- **A boot log line is expected on every start.** Same message as before
  (`question bank loaded`), plus a `bank refreshed` on each cycle the source
  actually moved and a `question bank refresh failed` when a cycle fails —
  the last one is the signal an operator watches for.
- **The manual endpoint sits inside `/admin/`.** Session-gated + CSRF-verified
  like every other state-changing route on this surface; the button's
  visibility follows the top bar's `.Professor` guard. Neither an anonymous
  visitor nor a signed-out browser tab can trigger a refresh. *(Amended
  2026-08-27 — the button moved to the `/controls` index; the same
  `.Professor` gate covers it because `/controls` sits behind
  `RequireProfessor`. See §Amendment — 2026-08-27.)*

## Amendment — 2026-08-25 (page-only annotations)

`<Question>` may carry a nested `<Explanation>` block (a pedagogical note
attached to the answer). The block is authored the same way as the rest of
the question, but it is **deliberately dropped by the source reader** and
therefore never enters `questions.json` — the bank stays the exact
stems + alternatives + correct-set the contract promises. The rendered-tree
reader (`lib/questions.ts`) picks the note up separately and hands it to
`<Question>`, which paints it in a subtle panel below the verdict, only
after the reader has answered.

The asymmetry is by design: the printed sheet and the entrance-controls
generator must not see the explanation (a note that "spoils" the answer on
the printed page defeats the point of a control), while the study version
of the material benefits from teaching the WHY of the answer as the reader
crosses each question. "Two readers, one authored source, one artifact
deliberately unaware" is now a first-class pattern of the question
subsystem; any future annotator that follows the same shape (declared via a
`questionRole` value, dropped by the source parser, unwrapped by the
rendered-tree parser) inherits this ADR without needing its own.

## Amendment — 2026-08-27 — the "Recargar banco" button lives on `/controls`, not in the navbar (issue #254)

**Context.** §Addendum (2026-08-26) placed the manual escape hatch's button
"in the backoffice top bar" so it was one click away from every backoffice
page. Two weeks of using it argued the placement was misjudged: the
backoffice grew a second CRUD ("Controles"), and the top bar had space for
one section link at most before the row got busy. Adding `href="/controls"`
next to `href="/professors"` made the "Recargar banco" `<form>` the third
occupant of a bar meant for navigation, and the button's own semantics —
"refresh the bank before creating a control" — placed it inside the
controls flow, not on top of every unrelated backoffice screen.

**Decision.** The `<form action="/admin/bank/refresh">` moves from
`layout.html` to the `/controls` index page (`pages/controls_list.html`),
next to the "Nuevo control" anchor. Nothing else changes: the route is
still `POST /admin/bank/refresh`, session-gated + CSRF-verified, and its
Referer-derived redirect is unchanged (the docstring on `AdminBank.Refresh`
now explains the same-origin guard survives a future caller from another
page). The `.Professor` gate that ADR-0032 §Addendum §Consequences named
"the top bar's" is now "the `/controls` list's" — same gate shape (the
whole backoffice sits behind `RequireProfessor`), different template.

**Why an amendment and not a new ADR.** The endpoint's contract is
unchanged, the atomicity guarantee is unchanged, the failure semantics
are unchanged. What moved is one HTML surface. `documentation.md` §Rule 4
grows standards from recorded cases (plural); a single button moving out
of a two-item navbar does not yet justify a repo-wide "action buttons
live on their page, not in the global nav" rule. If a second global
action ever moves the same way, promote the rule then.

**Preserved wording.** The pre-#254 Addendum text is kept verbatim in the
"Manual escape hatch" bullet above and in the "The manual endpoint sits
inside `/admin/`" Consequences bullet, each with a trailing italic
pointer to this amendment — per `documentation.md` §Reviews falsify
claims ("it does not quietly replace the sentence").
