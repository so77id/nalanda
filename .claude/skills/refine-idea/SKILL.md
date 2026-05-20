---
name: refine-idea
description: Refine an idea into a well-formed GitHub Issue (WP) in the Backlog column of so77id/nalanda. Use when the user wants to convert a Discussion, an audit finding, or a fresh idea into actionable work with spec, AC, and slices. Triggers on `/refine-idea`, `/create-task`, or natural-language phrases like "refine #N", "let's turn this into a WP", "vamos a refinar esta idea".
---

# refine-idea — Process B

Convert a raw idea (Discussion / audit finding / fresh thought) into a well-formed GitHub Issue with spec, acceptance criteria, slices, and labels — placed in the Backlog column of the Project board. The output is the single source of truth for the WP.

## When to invoke

- The user types `/refine-idea`, `/refine-idea <discussion-number>`, or `/create-task`.
- The user says: "refine idea #N", "turn this into a WP", "vamos a refinar la #N", "create a task from <audit-id>".
- Do **not** invoke when the user wants to capture (Process A) or develop (Process C).

## Constants (from `docs/conventions.md`)

```
Repo:               so77id/nalanda
Repo node ID:       R_kgDOSGlAqQ
Project number:     3
Project ID:         PVT_kwHOAD5lg84BYOfH
Status field ID:    PVTSSF_lAHOAD5lg84BYOfHzhTVzpo
Backlog option ID:  3876d811
Ideas category ID:  DIC_kwDOSGlAqc4C9bBm
```

## Conversational flow

Total turns: 4 to 12, depending on idea clarity, conditional skills, and user iteration.

### Step 1 — Determine source

Identify where the idea comes from:

- **Discussion**: user references `#N` and N is a Discussion number, OR you fetched it from `💡 Ideas` and the user picked one.
  - Fetch with: `gh api graphql -f query='query { repository(...) { discussion(number: <N>) { title body labels(first:5){nodes{name}} url } } }'`
- **Audit finding** (when audits exist under `docs/audits/`): read the relevant audit and locate the section.
- **Fresh idea**: user describes something new in chat and wants it directly as a WP without first capturing it as a Discussion. Use the user's chat description as the seed.

If the user is ambiguous (e.g., "let's refine this"), ask: "Refine idea from a Discussion (give me #N), an audit finding (give me ID), or fresh from this chat?".

### Step 2 — Load context

Invoke `context-engineering`:
- Read root `CLAUDE.md` and any subdir `CLAUDE.md` matching the idea's apparent area.
- Read related ADRs in `docs/decisions/` (when present).
- Read related code areas if they are mentioned in the idea (filenames, components).
- Skim recent issues for adjacent work (`gh issue list --state all --search '<keyword>' --limit 10`).

### Step 3 — Idea-refine (conditional)

Only invoke `idea-refine` if the idea is **vague**: lacks a clear problem statement, lacks a clear scope boundary, or proposes multiple competing approaches without committing to one. Be transparent: "this idea is broad — let me run idea-refine to surface alternatives" and the user can accept or skip.

If the idea is already specific (most well-described Discussions), skip this step.

### Step 4 — Spec (always)

Invoke `spec` skill mentally — produce a Standard-depth spec (not light, not heavy) covering:

- **Problem** — one paragraph: what is wrong / missing / desired, and why now.
- **Goals** — bullet list of concrete outcomes.
- **Non-goals** — bullet list of what is explicitly excluded from this WP.
- **Design** — technical approach in plain language: components touched, key decisions, tradeoffs taken.

Keep it ≤300 lines total. If the WP needs deeper spec, recommend creating an ADR alongside (Process C will produce it).

Be conversational: draft the spec, show to user, let them edit.

### Step 5 — Conditional skills

Based on the spec, decide which skills apply and invoke them. Each is **optional** and you must justify why you invoke it:

| Skill | Trigger heuristic |
|---|---|
| `api-and-interface-design` | Spec introduces or modifies a public component prop API, route contract, or module boundary |
| `source-driven-development` | Spec depends on a library where API correctness matters (React, Vite, CodeMirror, framer-motion, WASI shim, etc.) |
| `security-and-hardening` | Spec touches user-supplied code execution, external data sources, or sandboxing |
| `performance-optimization` | Spec has performance goals, or affects hot paths (rendering, WASM execution, large lists) |
| `deprecation-and-migration` | Spec removes or replaces existing functionality |
| `frontend-ui-engineering` | Spec introduces or significantly changes user-facing UI |

Tell the user: "I'll also run `<skill>` because <reason>". User can accept or skip.

If the spec contains a non-trivial architectural decision, mark it for ADR creation in Process C (do not create the ADR here).

### Step 6 — Plan (always)

Invoke `plan` skill mentally — break the work into ordered slices:

- Each slice = one commit (per `docs/conventions.md`).
- Each slice has a single AC checkbox-able outcome.
- Order by dependency.
- Slice descriptions: `S<n>: <verb-led short description>`.

Show the user the slice list before finalizing.

### Step 7 — Draft the issue

**MANDATORY:** the issue body must contain the **full, verbatim spec + plan + todo content** generated by the spec and plan skills (and any other artefact produced during refinement). Not summaries. Not links. Full content inline.

The issue is the single source of truth — `develop-task` must have everything it needs in the body itself. If you find yourself writing "see `docs/X.md` for details" you are doing it wrong: inline the content, then optionally include a reference to the path.

Body structure:

1. **Header:** Type / Area / Source.
2. **Structured summary:** Problem / Goals / Non-goals / Design / AC / Slices / Notes (per `docs/conventions.md`). This is the high-level scan-friendly view.
3. **Full artefacts appended:** under `---` separators, sections `## Original specification`, `## Original plan`, `## Original todo` containing the **complete content** of each artefact.

If a section's artefact does not exist (e.g., trivial WP with no separate plan doc), omit that section. Do not put placeholders or "TBD".

Verify before creating: read your draft and confirm an agent could open this issue and execute the WP without ever opening another file (other than the codebase being modified).

```markdown
**Type:** <type without prefix>
**Area:** <area without prefix; comma-separated if multiple>
**Source:** Discussion #<N> | Audit YYYY-MM-DD §<id> | Fresh idea

## Problem
<one paragraph>

## Goals
- ...
- ...

## Non-goals
- ...

## Design
<technical approach>

## Acceptance criteria
- [ ] AC1
- [ ] AC2
- ...

## Slices
- [ ] S1: <description>
- [ ] S2: <description>
- ...

## Notes
<dependencies, risks, references>
```

**Title format:** `<verb>: <object>` in imperative, English, ≤80 chars.

**Labels:** one `type:*` plus one or more `area:*`.

### Step 8 — Confirm with user

Present the full draft inline. Ask: "Create the issue like this?". User can accept, edit any section, or cancel.

### Step 9 — Create the issue

Use `gh issue create` with `--body-file`:

```bash
# Write body to temp file
cat > /tmp/issue-body.md <<'EOF'
<the full body>
EOF

# Create issue
gh issue create \
  --repo so77id/nalanda \
  --title "<TITLE>" \
  --body-file /tmp/issue-body.md \
  --label "type:<x>" --label "area:<y>"

# Capture issue number from output
```

### Step 10 — Add to project Backlog

Add the new issue to the Project, then set its Status to Backlog:

```bash
# Add issue to project
gh project item-add 3 --owner so77id --url https://github.com/so77id/nalanda/issues/<N>
# Output gives the item-id, e.g. PVTI_...

# Set status to Backlog
gh project item-edit \
  --project-id PVT_kwHOAD5lg84BYOfH \
  --id <ITEM_ID> \
  --field-id PVTSSF_lAHOAD5lg84BYOfHzhTVzpo \
  --single-select-option-id 3876d811
```

### Step 11 — Close source Discussion (if any)

If the source was a Discussion, close it as Resolved with a comment linking the new issue:

```bash
# Add comment
gh api graphql -f query='
mutation {
  addDiscussionComment(input: {
    discussionId: "<DISCUSSION_ID>",
    body: "Promoted to issue #<N>: https://github.com/so77id/nalanda/issues/<N>"
  }) { comment { id } }
}'

# Close as Resolved
gh api graphql -f query='
mutation {
  closeDiscussion(input: {
    discussionId: "<DISCUSSION_ID>",
    reason: RESOLVED
  }) { discussion { closed closedAt } }
}'
```

If the source was an audit, do not modify the audit doc (it remains a historical reference). The `Source:` field in the issue body is enough.

### Step 12 — Confirm to user

Tell the user:

```
Created → #<N>: <title>
Project: Backlog
URL: https://github.com/so77id/nalanda/issues/<N>
```

If a Discussion was closed: "Closed Discussion #<M> as Resolved with link to #<N>."

Ask: "Refine another, or back to what we were doing?".

## Edge cases

### Idea is too small

If the idea is genuinely a 1-line typo or trivial fix, suggest "yolo mode" instead (per `docs/conventions.md`): make the change directly, no issue, commit to main. Do not refine.

### Idea is too big

If the spec exceeds ~300 lines or has ≥10 slices with weak cohesion, propose splitting into multiple issues with a meta-issue linking them. Per `docs/conventions.md`, an Epic can be modeled as a parent issue with sub-issues — but for now we typically prefer multiple sibling issues with cross-references in `Notes`.

### User wants to refine without spec/plan

If the user explicitly says "skip the spec", produce a minimal issue: `Problem` + `AC` + `Slices` only. Honor it.

### Audit reference not found

If the user says "refine A99" and A99 does not exist in the audits, ask for clarification. Do not invent.

### Duplicate of existing open issue

Before Step 9, run `gh issue list --search "<title-keywords>" --state open` and check for near-duplicates. If found, surface to user with options: (a) create new anyway, (b) add comment to existing, (c) cancel.

### `gh` failures

- **Auth:** ask user to run `gh auth status` and `gh auth login` if needed.
- **Project not found:** verify the IDs in `docs/conventions.md` are still valid.
- **Issue created but project add failed:** the issue exists in main timeline, but is not on the kanban. Surface error and ask user to add manually or retry.

## Operational quick reference

| Action | Command |
|---|---|
| Fetch a Discussion | `gh api graphql -f query='query { repository(...) { discussion(number: <N>) { ... } } }'` |
| Create an issue | `gh issue create --repo so77id/nalanda --title "..." --body-file ... --label ...` |
| Add issue to project | `gh project item-add 3 --owner so77id --url <ISSUE_URL>` |
| Set issue Status | `gh project item-edit --project-id PVT_kwHOAD5lg84BYOfH --id <ITEM_ID> --field-id PVTSSF_lAHOAD5lg84BYOfHzhTVzpo --single-select-option-id <OPTION_ID>` |
| Comment on Discussion | `gh api graphql -f query='mutation { addDiscussionComment(...) { ... } }'` |
| Close Discussion | `gh api graphql -f query='mutation { closeDiscussion(input: { discussionId: ..., reason: RESOLVED }) { ... } }'` |
| Search issues | `gh issue list --search "<keywords>" --state all` |
