# Conventions — Nalanda

This document is the source of truth for development conventions: kanban columns, labels, branch naming, commit format, **slice planning**, PR template, and worktree setup. The `agentic-workflow` plugin skills reference this file and `.claude/workflow-bindings.md` (which owns the machine-readable IDs).

## Project board IDs

Machine-readable IDs (repo, project, status columns, Discussions category) live
in **`.claude/workflow-bindings.md`** — the single home the plugin skills read.
Regenerate or repair them with `/init-workflow`.

## Kanban columns

| Column      | Purpose                                                 |
| ----------- | ------------------------------------------------------- |
| Backlog     | Refined issues waiting to be promoted to Ready          |
| Ready       | Promoted issues — agent can pick the next one from here |
| In Progress | Currently being developed in a worktree                 |
| Review      | PR open, awaiting user review and squash merge          |
| Done        | Closed and merged                                       |

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

**A slice that pins a defect cannot be its own commit**, and this constrains
how a WP is planned, not only how it is committed. Such a slice ends red by
construction — a test written to fail is the whole point of it — so plan the
pin and the fix as ONE slice; the red step still happens, inside it, and the
commit lands green. Worked case (#98), where they were refined as S1 and S2 and
had to be merged mid-development after S1 was committed red and the commit
dropped with `git reset` — there is no revert commit, and after the mandatory
squash merge nothing in this repository records it, which is itself the reason
the rule is written here rather than left as a war story.

**A slice whose product is evidence rather than code has no diff.** Commit it
with `git commit --allow-empty` and put the runs, the counts and the mutations
in the message — or fold it into the slice it verifies. Do not manufacture a
change to carry it. Worked case: #98's S4, twenty consecutive suite runs and a
load experiment whose control also passed, which is a result worth keeping
precisely because it proved nothing.

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

### Name your target, always

Parallel worktrees mean parallel processes, parallel branches and a shared
remote. A command whose scope is implicit acts on all of them. Three worked
cases, all from #87, all the same mistake — **a command reaching past what the
author was looking at**:

```bash
pkill -f "vite preview"                 # ✗ kills every session's server
lsof -ti tcp:<port> | xargs kill        # ✓ the one you started

git checkout -- <path>                  # ✗ reverts ALL uncommitted work there
git stash push -- <file>                # ✓ or just commit first, then experiment

git push --force-with-lease             # ✗ pushes every matching branch
git push --force-with-lease origin <branch>:<branch>   # ✓ only yours
```

- `pkill -f` took down two other sessions' preview servers; they were doing the
  same thing back within the hour.
- `git checkout -- apps/web/src` erased a slice's tests that were not yet
  committed, and the mutation run that followed silently proved nothing.
- **The expensive one:** `git push --force-with-lease` with no refspec also
  pushed a stale local `main`, rolling the published branch back two commits and
  dropping two already-merged PRs from its history. `--force-with-lease` did not
  help — the lease is computed against the stale ref, which was the problem.
  Recovering it needed a fresh PR (#101), because writing to `main` is blocked —
  correctly, and by the control that should have stopped the push itself.

Before a destructive or remote-facing command, say the target out loud: this
port, this file, this branch.

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
   — when writing Slices, note that a slice which only pins a defect cannot be
   its own commit (§Commit format); plan the pin and its fix as one.
3. **Full artefacts appended:** `## Original specification`, `## Original plan`, `## Original todo` containing the complete content of any artefact produced during refinement

The issue is the single source of truth for the WP. `develop-task` must have everything it needs in the body — no "see file X" references.
