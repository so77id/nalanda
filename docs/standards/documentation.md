# Documentation Standard

Where every kind of knowledge lives in Nalanda, and the rule that keeps docs
honest: **documentation is part of the Definition of Done** — a change is not
finished until its documentation exists, and review verifies it (ADR-0005).

## Where does each kind of knowledge go

| Knowledge                                                            | Lives in                                                                                                                                                                                                                                                                               | Example                                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How to install/run/test an app                                       | That app's `README.md`                                                                                                                                                                                                                                                                 | `apps/web/README.md`                                                                                                                                      |
| Agent operating instructions for an app                              | That app's `CLAUDE.md`                                                                                                                                                                                                                                                                 | agent rules + standard pointers (commands/stack live in the app README — one home)                                                                        |
| Monorepo-shared agent instructions                                   | Root `CLAUDE.md`                                                                                                                                                                                                                                                                       | methodology, hard rules                                                                                                                                   |
| Repo layout & placement rules                                        | `docs/standards/repository-structure.md`                                                                                                                                                                                                                                               | where does X go                                                                                                                                           |
| Code style (per language)                                            | `docs/standards/<lang>-code-style.md`                                                                                                                                                                                                                                                  | naming, folder layout                                                                                                                                     |
| Testing levels & protocols                                           | `docs/standards/testing-strategy.md`                                                                                                                                                                                                                                                   | per-commit / pre-PR                                                                                                                                       |
| "How to add a new X" walkthroughs                                    | `docs/standards/integration-guides.md` (index) + guide files                                                                                                                                                                                                                           | add an app, add a component                                                                                                                               |
| Architectural decisions                                              | `docs/decisions/` (ADRs, numbered)                                                                                                                                                                                                                                                     | why Go, why MDX                                                                                                                                           |
| Design narratives                                                    | `docs/design/`                                                                                                                                                                                                                                                                         | 2026-08 redesign                                                                                                                                          |
| Content-component usage (what authors see)                           | The **catalog** (`/catalog` in-app)                                                                                                                                                                                                                                                    | when to use `<Slide>`, props, examples                                                                                                                    |
| Component governance (contract, how-to-add, doc + review checklists) | The **catalog governance page** (`/catalog/governance`, authored in `apps/web/src/catalog/GovernancePage.tsx`) — the operational home authors and agents read; ADR-0010/0014 hold the decisions and win on disagreement, `guides/add-a-content-component.md` maps them onto repo paths | the component contract points                                                                                                                             |
| Workflow conventions (kanban, branches, PRs, slice planning)         | `docs/conventions.md`                                                                                                                                                                                                                                                                  | commit format                                                                                                                                             |
| How an app is published & operated                                   | Root `README.md` §Deployment (repo-level: URL, trigger, rollback, what to verify) + that app's `README.md` (app-level build shape: base path, emitted artifacts, gotchas)                                                                                                              | Pages publication of `apps/web` (#66)                                                                                                                     |
| Security deferrals / advisory dispositions                           | `docs/security-notes.md`                                                                                                                                                                                                                                                               | accepted-risk records with review triggers                                                                                                                |
| Third-party asset provenance & licence                               | a `README.md` beside the assets                                                                                                                                                                                                                                                        | per-file source, licence and what was modified — the accepted-risk half goes to `security-notes.md` (worked case: `content/courses/sample-course/logos/`) |
| Course planning material                                             | `docs/course-graph.md` + `docs/graphs/`                                                                                                                                                                                                                                                | topic dependencies, topology diagrams                                                                                                                     |

**One home per fact.** If two documents need the same fact, one states it and the
other links to it. Duplicated prose drifts.

**Documentation that must never drift is written as code and gated by a test.**
When a doc describes a set that grows (components today; event types, endpoints
tomorrow), prefer a typed entry colocated with each member over a hand-maintained
page, expose it as a product surface, and add an L4 invariant that fails on
hollow entries — empty required prose, missing examples, examples that render
nothing, published paths that do not resolve. Prose pages stay the default for
one-off narratives. Worked case: the catalog (#65).

The same rule covers **facts the test environment cannot observe** — build-resolved
config, emitted artifacts, host behavior. Document them in prose once, and pin
each documented claim with an assertion against the real source (the config
object, the emitted file), so the doc fails the suite when it goes stale. Worked
case: the deployed shape (#66).

## Rules

1. **Docs ship in the same PR** as the change that makes them necessary. The
   Tier-4 review step asks "which docs does this diff obligate?" — the table
   above is the answer key.
2. **ADR when a decision is architectural**: library/tool selection, cross-module
   structure, reversing a prior ADR, accepted operational constraints. Not for
   local changes, bug fixes, or refactors without boundary changes.
3. **Catalog entry when a content component changes**: adding or modifying a
   component without updating its catalog entry fails review (ADR-0010).
4. **Standards grow by recorded cases**: when reality presents a case no standard
   covers, the PR proposes the rule and records it in the right standard document
   (same growth rule as `repository-structure.md`).
   **Visual-design decisions are recorded in `design-system.md`** — colour today,
   typography and spacing as they arrive. A decision about how the product LOOKS
   is a decision like any other: undocumented, the next author reads it off
   whichever neighbouring file they happen to open, which is how the product
   ended up with two neutral families nobody chose (#109).
5. **English everywhere** in repo artifacts. Spanish for everything the _reader_
   perceives — course content, UI chrome, and accessible names — plus real-time
   conversation (root `CLAUDE.md` §Language). `/catalog` is the exception that
   proves the rule: it ships with the site but addresses component authors, so
   it stays English — **except its live examples**. A component page
   (`/catalog/c/:name`) renders the real component, so its demo snippets and the
   widgets' own chrome address students and stay Spanish; the page says so in
   one line, and the guard is split to match: registry data in
   `catalog/architecture.test.tsx`, rendered pages in `app/catalogRoute.test.tsx`,
   which skips that route deliberately (#87).
6. **Latent gotchas are documented inline where they bite** — dated, naming the
   exact failure mode and the remediation (e.g., the path-filter note in
   `ci.yml`, the review triggers in `security-notes.md`). **A magic geometric
   value takes the stronger form**: the measurement it came from, the concrete
   case that breaks if it changes, and the cheaper alternative that was
   rejected — written at the value, not only in an ADR. Worked cases (#84): the
   39rem reading measure in `styles/index.css` (84 characters measured — and
   the counting convention, which is half the fact — the
   376px `<SideBySide>` column that breaks at a narrower container, and the
   rejected "narrow the container"), and the rail breakpoint in
   `DocumentPage.tsx` (256 + 64 + 768 + 224 = 1312, so `2xl`; `xl` lands 32px
   short).
7. **Retiring a tool or model obligates a sweep**: in the same PR, grep ALL
   instruction surfaces (`CLAUDE.md` files, `.claude/skills/`, `.claude/agents/`,
   `docs/conventions.md`, standards) for the retired terms and update every hit.
   Partial migrations make instruction consistency depend on which file an agent
   reads first.

## Rules for empirical claims in ADRs

A performance, feasibility or platform-capability claim carries **the
measurement, the date, and the case that does NOT hold**. An unmeasured "it is
fast enough" or "the platform handles it" is a hypothesis, not a decision, and
the next reader cannot tell which they are looking at.

Worked case (issue #74): ADR-0017 first said "the page stays responsive anyway
(timers keep firing while a Java program blocks)" — generalised from the one
case that had been spiked, a program waiting on `System.in`. A CPU-bound loop
yields nothing, and the review measured a probe still blocked 45s past its
deadline. The corrected text names both cases with numbers and dates.

**When review falsifies a claim, the correction stays visible.** The accepted ADR
says what was claimed, what demonstrated otherwise, and what the honest statement
is — it does not quietly replace the sentence. A silently repaired ADR reads as
though the decision was always right, which teaches the next reader to trust
exactly the kind of claim that turned out to be wrong. Worked cases (issue #76):
ADR-0019 §3/§7, where a draft asserted the checker was beyond the student's reach
and the review forged a green board twice in a browser; and ADR-0020 §6, where
capping the output was written up as a fix and measured, twice, not to be one.

**A guard is evidence only if it can fail for the reason you are citing.** An
invariant written as "X never reaches Y" is proven by walking the graph, not by
grepping for the names of the X's we have already met — a name-based guard is a
hypothesis about the violator set. Worked case (issue #85): ADR-0018 §Consequences said
`grep` proved no runtime code was in the entry chunk. Two green tests, one green
grep, and the eager payload had gone from 1 chunk / 503,623 B to 9 / 542,194 B,
because neither regression touched a named module. The ADR now carries the
correction and the numbers; the invariant walks from `app/main.tsx` and asks an
allowlist question.

## Two shapes this repo learned the hard way

**When a duplicated fact is removed, the surviving note records the drift that
justified removing it.** One home per fact is the rule; this is its enforcement,
and it is the same shape Rule 6 already demands for a magic value. Worked case:
`apps/amc-worker/worker.py` deleted a route table from its own docstring and
said why — the copy had already drifted from the handlers below, inside the PR
that wrote it, omitting a required field and naming response keys the code does
not return (#138 review, F-13).

**A manual verification procedure states its steps in prose and its SETUP as a
target the reader runs.** A prose command list for a procedure a human performs
with paper in hand drifts exactly like duplicated prose, and it fails at the
worst moment — after the printing and the marking. Where its output carries
personal data, the procedure also states what may be recorded and where. Worked
case: `apps/amc-worker/PAPER-CHECK.md` plus `make paper` / `make read-paper`,
after two rounds of review found its command list wrong twice — the second time
omitting a step that would have left the reader with an empty layout and no way
to tell that from an engine failure (#138).

## ADR format

ADRs live in `docs/decisions/<NNNN>-<kebab-title>.md`, numbered sequentially:

```markdown
# ADR-NNNN: <title>

**Status:** Proposed | Accepted | Accepted — <verification> outstanding |
Archived | Superseded by ADR-MMMM
**Date:** YYYY-MM-DD
**Decision-makers:** <who>
**Source:** <conversation/issue/PR that produced it>

## Context · ## Decision · ## Alternatives considered · ## Consequences
```

## References

- ADR-0005 (dev standards) · ADR-0010 (catalog) · `docs/conventions.md`
