# Conventions — Nalanda

This document is the source of truth for development conventions: kanban columns, labels, branch naming, commit format, PR template, and worktree setup. The `.claude/skills/*` workflows reference this file by name.

## Project board IDs

**Setup required:** the user must create a GitHub Project for Nalanda with a Status field containing at least the columns below. Once created, fetch the IDs and fill in the placeholders.

```
Repo:               so77id/nalanda
Repo node ID:       R_kgDOSGlAqQ
Project number:     3
Project ID:         PVT_kwHOAD5lg84BYOfH
Status field ID:    PVTSSF_lAHOAD5lg84BYOfHzhTVzpo
  Backlog     → 3876d811
  Ready       → d471aa12
  In Progress → 709335dd
  Review      → 4bbf67b2
  Done        → 374a7858
Ideas category ID:  DIC_kwDOSGlAqc4C9bBm  # GitHub Discussions, 💡 Ideas category
```

How to fetch:

```bash
# Project + Status field
gh api graphql -f query='
query {
  user(login: "so77id") {
    projectV2(number: 3) {
      id
      field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          options { id name }
        }
      }
    }
  }
}'

# Discussions Ideas category (requires Discussions enabled on the repo)
gh api graphql -f query='
query {
  repository(owner: "so77id", name: "nalanda") {
    discussionCategories(first: 10) { nodes { id name } }
  }
}'
```

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

One commit per slice. Every commit must leave lint clean and relevant smoke tests green.

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
- Added/changed smoke tests: ...
- All passing: ✓

## Reviews run
- Tier 2 (review): ...
- Tier 3: ...
- Tier 4 (docs): ...

## Manual verification
- ✓ ...

## Notes
...
```

PRs must be **squash-merged** manually by the user.

## Worktrees

Each WP is developed in its own worktree to allow parallel work:

```bash
git fetch origin
git worktree add -b <type>/issue-<N>-<slug> ../nalanda-issue-<N> main
cd ../nalanda-issue-<N>
npm install
```

`npm install` is required because `node_modules/` is gitignored and not present in the new worktree.

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

## Issue body structure

Every refined issue body must contain, in this order:

1. **Header:** `**Type:** ...`, `**Area:** ...`, `**Source:** ...`
2. **Structured summary:** Problem / Goals / Non-goals / Design / Acceptance criteria / Slices / Notes
3. **Full artefacts appended:** `## Original specification`, `## Original plan`, `## Original todo` containing the complete content of any artefact produced during refinement

The issue is the single source of truth for the WP. `develop-task` must have everything it needs in the body — no "see file X" references.
