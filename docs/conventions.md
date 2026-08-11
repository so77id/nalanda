# Conventions — Nalanda

This document is the source of truth for development conventions: kanban columns, labels, branch naming, commit format, PR template, and worktree setup. The `agentic-workflow` plugin skills reference this file and `.claude/workflow-bindings.md` (which owns the machine-readable IDs).

## Project board IDs

Machine-readable IDs (repo, project, status columns, Discussions category) live
in **`.claude/workflow-bindings.md`** — the single home the plugin skills read.
Regenerate or repair them with `/init-workflow`.

## Kanban columns

| Column      | Purpose                                                                 |
|-------------|-------------------------------------------------------------------------|
| Backlog     | Refined issues waiting to be promoted to Ready                          |
| Ready       | Promoted issues — agent can pick the next one from here                 |
| In Progress | Currently being developed in a worktree                                 |
| Review      | PR open, awaiting user review and squash merge                          |
| Done        | Closed and merged                                                       |

## Labels

Every issue gets:
- One `type:*` label — `type:bug`, `type:feature`, `type:refactor`, `type:docs`, `type:chore`
- One or more `area:*` labels — `area:widgets`, `area:course`, `area:presentation`, `area:runtime`, `area:infra`, `area:docs`

Create them once with:

```bash
gh label create "type:feature"      --repo so77id/nalanda --color 0e8a16
gh label create "type:bug"          --repo so77id/nalanda --color d73a4a
gh label create "type:refactor"     --repo so77id/nalanda --color a2eeef
gh label create "type:docs"         --repo so77id/nalanda --color 0075ca
gh label create "type:chore"        --repo so77id/nalanda --color cccccc

gh label create "area:widgets"      --repo so77id/nalanda --color fbca04
gh label create "area:course"       --repo so77id/nalanda --color fbca04
gh label create "area:presentation" --repo so77id/nalanda --color fbca04
gh label create "area:runtime"      --repo so77id/nalanda --color fbca04
gh label create "area:infra"        --repo so77id/nalanda --color fbca04
gh label create "area:docs"         --repo so77id/nalanda --color fbca04
```

## Branch naming

```
<type>/issue-<N>-<slug>
```

- `<type>`: branch type derived from the `type:*` label. `type:bug → fix`, others pass through (`feature`, `refactor`, `docs`, `chore`).
- `<N>`: issue number.
- `<slug>`: kebab-case from the issue title, max ~5 words.

Examples:
- `feature/issue-42-graph-ds-visualizer`
- `fix/issue-51-codemirror-line-tracker`
- `refactor/issue-45-extract-visualizer-base`

## Commit format

One commit per slice. Every commit must pass the touched app's **per-commit
protocol** (see `docs/standards/testing-strategy.md`); every PR passes the
**pre-PR protocol** before publishing.

```
<type>(issue-<N>): S<n> <slice description>

<optional body — only if the change has non-obvious context>

Refs #<N>
```

`<type>` matches the branch type. Example: `feature(issue-42): S1 add graph DS scaffold`.

## PR template

```
**Closes #<N>**

## Summary
<1-3 bullets>

## Slices completed
- [x] S1: ...
- [x] S2: ...

## Acceptance criteria
- [x] AC1 — evidence
- [x] AC2 — evidence

## Tests
- Added/changed tests (per `testing-strategy.md` levels): ...
- Protocols run: per-commit ✓ · pre-PR ✓

## Reviews run
- Pipeline Round A (code panel): <findings/dispositions>
- Pipeline Round B (docs panel): <findings/dispositions>
- Verifier table + per-fix rechecks: <reference>
- Patterns recorded: <or none>

## Manual verification
- ✓ ...

## Notes
...
```

PRs must be **squash-merged** manually by the user.

**Component PRs**: any PR adding or modifying a content component must include
its catalog entry (ADR-0010; enforced by the completeness test and the review
checklist at `/catalog/governance`).

## Worktrees

Each WP is developed in its own worktree to allow parallel work:

```bash
git fetch origin
git worktree add -b <type>/issue-<N>-<slug> ../nalanda-issue-<N> main
cd ../nalanda-issue-<N>/apps/<app>   # each app is self-contained; e.g. apps/web
npm install
```

`npm install` runs inside the affected app (there is no root `package.json`);
`node_modules/` is gitignored and not present in the new worktree.

When the PR is merged, remove the worktree from the main directory:

```bash
cd /Users/so77id/workspace/nalanda
git worktree remove ../nalanda-issue-<N>
```

## Yolo mode (trivial fixes)

For changes that meet ALL of these criteria, the workflow above can be bypassed:

- ≤3 lines changed
- No new logic (typo, copy edit, dependency-free reorder)
- Negligible risk (no chance of breaking existing behavior)
- Lint passes
- Trivially smoke-testable by visual inspection

Commit directly to `main` with a clear message. Do not create an issue.

**A yolo commit under `apps/web/**` or `content/**` publishes the live site**
(`deploy.yml` triggers on those paths). Its `build` job runs lint and tests
first, so a commit that fails those never publishes — but runtime breakage the
suite cannot see does, and the change goes live unreviewed. Check the live URL right after pushing; the
rollback is a revert, which redeploys the previous version (README §Deployment).

## Issue body structure

Every refined issue body must contain, in this order:

1. **Header:** `**Type:** ...`, `**Area:** ...`, `**Source:** ...`
2. **Structured summary:** Problem / Goals / Non-goals / Design / Acceptance criteria / Slices / Notes
3. **Full artefacts appended:** `## Original specification`, `## Original plan`, `## Original todo` containing the complete content of any artefact produced during refinement

The issue is the single source of truth for the WP. `develop-task` must have everything it needs in the body — no "see file X" references.
