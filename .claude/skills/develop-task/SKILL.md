---
name: develop-task
description: Develop a GitHub Issue (WP) into a merged PR end-to-end. Setup worktree + branch, run full-auto TDD per slice, run the 4-tier pre-PR review, open a PR with the standard template. Triggers on `/develop-task <N>`, `/develop <N>`, or natural-language phrases like "let's develop #N", "vamos con #N", "implementemos la tarea #N".
---

# develop-task — Process C

> **DEPRECATED (2026-08-06)**: superseded by the `agentic-workflow` plugin's
> `develop-task` (protocol-driven). Parts of this file predate
> `docs/standards/testing-strategy.md` (puppeteer model, root npm install,
> SPEC.md routing) — **where they conflict, the standards win.** This file is
> removed by the plugin-migration PR.

Take an issue from Backlog or Ready, develop it slice by slice via full-auto TDD-style verification, run the pre-PR review pipeline (4 tiers), and open a PR ready for the user's review and squash merge. The user keeps responsibility for manual verification, PR review, and merge.

## When to invoke

- The user types `/develop-task <N>` or `/develop <N>`.
- The user says: "let's develop #N", "vamos con #N", "implementemos la tarea #N", "let's work on issue 42".
- Do **not** invoke when the user wants to capture (Process A), refine (Process B), or groom (Process D).

## Constants (from `docs/conventions.md`)

```
Repo:               so77id/nalanda
Project number:     3
Project ID:         PVT_kwHOAD5lg84BYOfH
Status field ID:    PVTSSF_lAHOAD5lg84BYOfHzhTVzpo
  Backlog     → 3876d811
  Ready       → d471aa12
  In Progress → 709335dd
  Review      → 4bbf67b2
  Done        → 374a7858
Main worktree path: /Users/so77id/workspace/nalanda
```

## Phase 1 — Setup

### 1.1 Verify and load the issue

```bash
gh issue view <N> --repo so77id/nalanda --json number,title,body,labels,state
gh project item-list 3 --owner so77id --format json | grep '"number":<N>'
```

Confirm:
- Issue is open.
- Issue has at least one `type:*` label and one `area:*` label.
- Issue is on the Project in column Backlog or Ready (or already In Progress if resuming).
- Issue body contains `## Slices` section with `[ ]` checkboxes.

If any check fails: report and ask the user (e.g., "issue lacks a type label, fix it first" or "this issue is in Done, did you mean a different one?").

### 1.2 Move kanban → In Progress

If issue is in Backlog or Ready:

```bash
gh project item-edit \
  --project-id PVT_kwHOAD5lg84BYOfH \
  --id <PROJECT_ITEM_ID> \
  --field-id PVTSSF_lAHOAD5lg84BYOfHzhTVzpo \
  --single-select-option-id 709335dd
```

### 1.3 Infer branch type

Read the `type:*` label; the branch type is its value without the prefix:

```
type:bug      → fix
type:feature  → feature
type:refactor → refactor
type:docs     → docs
type:chore    → chore
```

Note: `type:bug` maps to `fix` per conventions, the rest pass through.

Branch name: `<type>/issue-<N>-<slug>` where `<slug>` is kebab-case from the issue title (max ~5 words).

### 1.4 context-engineering

Per `docs/conventions.md`, **the issue body is the single source of truth for the WP** — it must contain the full spec, plan, and todo content inline. Verify this before going further:

- The issue body should have a `## Original specification` (or equivalent) section with the complete spec content.
- A `## Original plan` section with the complete plan content (when applicable).
- A `## Original todo` section with the complete checklist (when applicable).

If the body is just a summary with pointers to external files, **stop and report** — the issue was not refined per the convention. Ask the user whether to refine it now (re-running through Process B) or proceed knowing context is incomplete.

Then invoke the context-engineering skill mentally:
- Read root `CLAUDE.md`.
- Read any subdir `CLAUDE.md` matching the issue's `area:*` label.
- Read related ADRs in `docs/decisions/` (when present).
- Read related code in the inferred area (use grep/glob to find components/widgets).
- Skim adjacent open PRs and recently merged ones for shared context.

### 1.5 Create worktree

From the main worktree directory:

```bash
git fetch origin
# Create a new branch off main and a worktree at ../nalanda-issue-<N> in one go.
# This avoids the "main is already checked out" error that occurs with
# `git worktree add <path> main` when main is checked out at the primary worktree.
git worktree add -b <type>/issue-<N>-<slug> ../nalanda-issue-<N> main
cd ../nalanda-issue-<N>
npm install
```

`npm install` is needed because the worktree starts without `node_modules/` (it is gitignored).

### 1.6 Comment on issue

```bash
gh issue comment <N> --repo so77id/nalanda --body "🚧 Started development.

Branch: \`<type>/issue-<N>-<slug>\`
Worktree: \`../nalanda-issue-<N>\`"
```

## Phase 2 — Slice loop (full-auto, test-first when applicable)

For each unchecked `[ ]` slice in the issue body, in order:

### 2.1 Announce

Print: `Starting S<n>: <slice description>`.

### 2.2 Test first (when applicable — red)

Nalanda uses puppeteer smoke tests rather than a unit-test framework. If the slice introduces or changes a user-observable behavior:

- Invoke `test-driven-development` skill.
- Identify or create the smallest smoke test that asserts the slice's outcome (`smoke-test-<feature>.mjs`).
- Run the relevant smoke test. Confirm RED.

For internal refactors with no behavior change, skip this step — the existing smoke tests serve as regression guard.

### 2.3 Implement (green)

Invoke `incremental-implementation` skill:
- Write the minimal implementation to satisfy the slice / test.
- Run `npm run lint`. Fix lint errors before continuing.
- Run the relevant smoke test (or the full smoke suite if multiple were touched). Confirm GREEN.
- If any other smoke test breaks, the slice has unintended impact — pause and consult the user.

### 2.4 Refactor (only if obvious)

If the implementation has obvious cleanup (rename, extract small component/hook, remove duplication just introduced) and tests still pass, do it. Do not refactor adjacent code; that violates scope discipline.

### 2.5 Commit

```bash
git add -A
git commit -m "$(cat <<'EOF'
<type>(issue-<N>): S<n> <slice description>

<optional body — only if the change has non-obvious context>

Refs #<N>
EOF
)"
```

### 2.6 Mark slice as done

Update the issue body via `gh issue edit --body-file` to flip `[ ] S<n>` to `[x] S<n>`.

```bash
# Fetch current body, modify, re-upload
gh issue view <N> --repo so77id/nalanda --json body --jq '.body' > /tmp/issue-body.md
# Programmatically flip the checkbox for S<n>
sed -i '' "s/^- \[ \] S<n>:/- [x] S<n>:/" /tmp/issue-body.md
gh issue edit <N> --repo so77id/nalanda --body-file /tmp/issue-body.md
```

### 2.7 Continue or break

If more unchecked slices remain → next slice. If all done → Phase 3.

### Exit conditions for the slice loop

Pause and surface to the user when any of these occur:

- Test cannot be made to fail after 2 attempts.
- Implementation cannot reach green after multiple attempts (unclear root cause).
- Suite breaks somewhere unrelated to the slice.
- The slice turns out to be larger than estimated and should be split (propose `S<n>a` and `S<n>b` and update issue body).
- A blocker appears (missing dependency, external change required).
- Merge conflict with main.

In all cases: comment the blocker on the issue with context, halt.

## Phase 3 — Pre-PR review pipeline

After the last slice is green, run all 4 tiers in order. Tiers 1-3 produce findings or block; Tier 4 is human-in-the-loop.

### Tier 1 — Mechanical (blocking)

Run from the worktree directory:

```bash
npm run lint
npm run build
# Run any smoke tests that cover changed areas
node smoke-test-<area>.mjs
```

If any fail: fix and rerun. Failures here block PR.

### Tier 2 — Code review (always run)

Invoke `code-review-and-quality` (`review`) on the diff between `main` and the current branch. Produces findings across 5 axes (correctness, readability, architecture, security, performance).

For each finding, ask the user: "Address now / defer / dismiss as not applicable?". For accepted fixes, generate a single review-fixes commit:

```
<type>(issue-<N>): review fixes

- <bullet for each addressed finding>

Refs #<N>
```

### Tier 3 — Conditional reviews (agent decides)

Read the diff and propose **only the skills that the diff actually warrants**. Do not invoke any skill solely on label hints — judge from content. State your reasoning to the user before invoking.

Heuristics (these are guides, not rules):

| Skill | Invoke when the diff... |
|---|---|
| `security-and-hardening` | introduces or modifies code execution sandboxes, external data sources, or anything that takes user input and acts on it |
| `performance-optimization` | adds work on render paths, modifies WASM execution, or affects animation loops; OR the issue mentions performance goals |
| `code-simplification` / `simplify` | the diff contains complex blocks (>30 lines of new logic in a single function/component, deep nesting, repeated patterns) where simplification would aid readability |
| `frontend-ui-engineering` | the diff introduces or significantly changes user-facing UI |
| `deprecation-and-migration` | removes or replaces an existing public API or feature that other code depends on |

Tell the user: "I propose running `<skill>` because <one-sentence reason>. Skip / proceed?".

If invoked, treat findings the same as Tier 2.

### Tier 4 — Documentation, AC, and manual gate (always run)

#### 4.1 Documentation review (`documentation-and-adrs`)

Invoke `documentation-and-adrs`. Identify which docs need updating based on the diff:

| Trigger | Update |
|---|---|
| Architectural decision baked into the diff | New ADR in `docs/decisions/<NNN>-<title>.md` |
| Pattern or convention changed globally | Root `CLAUDE.md` |
| Pattern or convention changed in one area | Subdir `CLAUDE.md` (when those files exist) |
| New "how to do X" pattern emerged | Section in the relevant subdir CLAUDE.md |
| New domain term | `docs/glossary.md` (when it exists) |
| Stack/setup changed | `README.md` |
| SPEC implications | `SPEC.md` |

For each identified doc, generate a draft and show to user. User approves, edits, or skips. After all are approved, commit:

```
docs(issue-<N>): <one-line summary of doc changes>

- ADR-NNN: <title>
- CLAUDE.md: <what changed>
- ...

Refs #<N>
```

#### 4.2 Acceptance criteria verification

List each AC from the issue body and produce evidence per AC:

```
AC1: <text>
  Evidence: commit <sha>, smoke test smoke-test-X.mjs, file src/path/file.jsx:line

AC2: <text>
  Evidence: <description>
```

If an AC has no clear evidence, halt and discuss with the user before proceeding.

#### 4.3 Manual verification checklist

Generate a manual checklist from the AC + slices for the user to run themselves:

```
Manual verification:
  □ <AC1 reformulated as user action>
  □ <AC2 ...>
  □ Smoke check: run `npm run dev` and try <flow>
```

Wait for user to report "all pass" or list specific failures. If failures: loop back to slice loop or fixes.

## Phase 4 — PR creation

### 4.1 Push branch

```bash
git push -u origin <branch>
```

### 4.2 Create the PR

Use `gh pr create` with the template from `docs/conventions.md`:

```bash
cat > /tmp/pr-body.md <<EOF
**Closes #<N>**

## Summary
<1-3 bullets of what was done end-to-end>

## Slices completed
- [x] S1: <description>
- [x] S2: <description>
- ...

## Acceptance criteria
- [x] AC1 — <evidence>
- [x] AC2 — <evidence>
- ...

## Tests
- Added/changed smoke tests: <list>
- All passing: ✓

## Reviews run
- Tier 2 (review): <X findings, Y addressed, Z deferred>
- Tier 3: <skills invoked or "none">
- Tier 4 (docs): <ADRs, CLAUDE.md updates, etc.>

## Manual verification
- ✓ <items>

## Notes
<observations, risks, links to created ADRs>
EOF

gh pr create \
  --repo so77id/nalanda \
  --base main \
  --head <branch> \
  --title "<type>: <short description matching issue title>" \
  --body-file /tmp/pr-body.md
```

### 4.3 Move kanban → Review

```bash
gh project item-edit \
  --project-id PVT_kwHOAD5lg84BYOfH \
  --id <PROJECT_ITEM_ID> \
  --field-id PVTSSF_lAHOAD5lg84BYOfHzhTVzpo \
  --single-select-option-id 4bbf67b2
```

### 4.4 Comment on issue

```bash
gh issue comment <N> --repo so77id/nalanda --body "🔍 PR opened: #<PR_NUMBER>

Ready for review and squash merge."
```

### 4.5 Hand back to user

Tell the user:

```
PR ready: <pr-url>
Issue: <issue-url> (now in Review)

Your turn: review, run any final manual checks, then squash-merge.
```

## Phase 5 — Post-merge (only if user requests cleanup help)

When the user confirms the PR was merged (or you detect closure via `gh pr view --json state`), do the cleanup:

### 5.1 Verify state

```bash
gh pr view <PR_NUMBER> --json state,mergedAt
gh issue view <N> --repo so77id/nalanda --json state
```

Both should be CLOSED / MERGED.

### 5.2 Move kanban → Done

The `Closes #<N>` in the PR body should auto-close the issue. If GitHub Actions or auto-close did not fire, do it manually:

```bash
gh project item-edit \
  --project-id PVT_kwHOAD5lg84BYOfH \
  --id <PROJECT_ITEM_ID> \
  --field-id PVTSSF_lAHOAD5lg84BYOfHzhTVzpo \
  --single-select-option-id 374a7858
```

### 5.3 Remove the worktree

From the main worktree directory:

```bash
cd /Users/so77id/workspace/nalanda
git worktree remove ../nalanda-issue-<N>
```

If the worktree has uncommitted changes (rare at this point), surface to user before forcing.

## Edge cases

### Resume an interrupted WP

If the issue is already In Progress and a worktree+branch exist, do not recreate them. Cd to the existing worktree, identify the next unchecked slice, continue from Phase 2.

### Multiple WPs in flight

The user can have several issues In Progress in parallel, each in its own worktree. This skill operates on one issue at a time; if asked to switch, finish or pause the current one cleanly.

### Slice discovers it needs to split

During Phase 2, if a slice is too large, propose to the user:

> S3 turned out to need two commits because <reason>. I propose:
>   - S3a: <new description>
>   - S3b: <new description>
>
> Update the issue body and continue?

On approval, `gh issue edit` to update the slice list.

### Diff is empty at PR time

If the branch has no commits ahead of main (everything was a no-op), abort the PR and surface "nothing to ship".

### `gh` failures

- Auth → ask user to re-auth.
- Rate limits → pause and retry once; surface if still failing.
- Worktree exists already → cd into it, do not error.

## Operational quick reference

| Action | Command |
|---|---|
| View issue | `gh issue view <N> --repo so77id/nalanda --json number,title,body,labels,state` |
| Edit issue body | `gh issue edit <N> --repo so77id/nalanda --body-file <file>` |
| Comment on issue | `gh issue comment <N> --repo ... --body "..."` |
| List project items | `gh project item-list 3 --owner so77id --format json` |
| Move kanban column | `gh project item-edit --project-id ... --id ... --field-id ... --single-select-option-id ...` |
| Create PR | `gh pr create --repo ... --base main --head <branch> --title "..." --body-file <file>` |
| View PR state | `gh pr view <PR_NUMBER> --json state,mergedAt` |
| Add worktree | `git worktree add ../nalanda-issue-<N> main` |
| Remove worktree | `git worktree remove ../nalanda-issue-<N>` |
