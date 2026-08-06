# Documentation Standard

Where every kind of knowledge lives in Nalanda, and the rule that keeps docs
honest: **documentation is part of the Definition of Done** — a change is not
finished until its documentation exists, and review verifies it (ADR-0005).

## Where does each kind of knowledge go

| Knowledge | Lives in | Example |
|---|---|---|
| How to install/run/test an app | That app's `README.md` | `apps/web/README.md` |
| Agent operating instructions for an app | That app's `CLAUDE.md` | agent rules + standard pointers (commands/stack live in the app README — one home) |
| Monorepo-shared agent instructions | Root `CLAUDE.md` | methodology, hard rules |
| Repo layout & placement rules | `docs/standards/repository-structure.md` | where does X go |
| Code style (per language) | `docs/standards/<lang>-code-style.md` | naming, folder layout |
| Testing levels & protocols | `docs/standards/testing-strategy.md` | per-commit / pre-PR |
| "How to add a new X" walkthroughs | `docs/standards/integration-guides.md` (index) + guide files | add an app, add a component |
| Architectural decisions | `docs/decisions/` (ADRs, numbered) | why Go, why MDX |
| Design narratives | `docs/design/` | 2026-08 redesign |
| Content-component usage (what authors see) | The **catalog** (`/catalog` in-app) | when to use `<Slide>`, props, examples |
| Workflow conventions (kanban, branches, PRs) | `docs/conventions.md` | commit format |
| Security deferrals / advisory dispositions | `docs/security-notes.md` | accepted-risk records with review triggers |
| Course planning material | `docs/course-graph.md` + `docs/graphs/` | topic dependencies, topology diagrams |

**One home per fact.** If two documents need the same fact, one states it and the
other links to it. Duplicated prose drifts.

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
5. **English everywhere** in repo artifacts. Spanish only in user-facing course
   content and real-time conversation.
6. **Latent gotchas are documented inline where they bite** — dated, naming the
   exact failure mode and the remediation (e.g., the path-filter note in
   `ci.yml`, the review triggers in `security-notes.md`).
7. **Retiring a tool or model obligates a sweep**: in the same PR, grep ALL
   instruction surfaces (`CLAUDE.md` files, `.claude/skills/`, `.claude/agents/`,
   `docs/conventions.md`, standards) for the retired terms and update every hit.
   Partial migrations make instruction consistency depend on which file an agent
   reads first.

## ADR format

ADRs live in `docs/decisions/<NNNN>-<kebab-title>.md`, numbered sequentially:

```markdown
# ADR-NNNN: <title>
**Status:** Proposed | Accepted | Archived | Superseded by ADR-MMMM
**Date:** YYYY-MM-DD
**Decision-makers:** <who>
**Source:** <conversation/issue/PR that produced it>

## Context · ## Decision · ## Alternatives considered · ## Consequences
```

## References

- ADR-0005 (dev standards) · ADR-0010 (catalog) · `docs/conventions.md`
