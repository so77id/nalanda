---
name: capture-idea
description: Capture a raw idea as a GitHub Discussion in the 💡 Ideas category of so77id/nalanda. Use when the user wants to save an idea for later without working on it now. Triggers on slash command `/capture-idea` or natural-language phrases such as "I have an idea", "save this idea", "tengo una idea", "anótame esto".
---

# capture-idea — Process A

Capture a raw idea as a GitHub Discussion in the `💡 Ideas` category, without forcing the user to specify acceptance criteria or implementation detail. The goal is to preserve **context surrounding the idea** so the user can return to it later — not to produce a refined spec (that is Process B).

## When to invoke

- The user types `/capture-idea` (explicit).
- The user uses natural-language triggers: "I have an idea", "save this idea", "anótame esto", "tengo una idea", "guárdame eso como idea", "para más adelante: ...". When detected, ask once: "Want me to save this as an idea?" before starting the flow.
- Do **not** invoke when the user is asking to develop, refine, or implement something. Those are Processes B and C respectively.

## Constants (from `docs/conventions.md`)

```
Repo:              so77id/nalanda
Repo node ID:      R_kgDOSGlAqQ
Ideas category ID: DIC_kwDOSGlAqc4C9bBm
```

If these IDs become stale (Project recreated, etc.), refresh `docs/conventions.md` first.

## Conversational flow

Total turns: 3 to 6, depending on whether duplicates exist and how clear the user's first description is.

### Step 1 — Listen and gather context

The user describes the idea with their own words. Read carefully. Identify:

- **What** the idea is (the core proposition).
- **Why now** (the trigger, what made them think of it).
- **Where it applies** (subsystem, module, scenario).

If any of those three are missing or unclear, ask **1 to 3 focused questions**. Limit to context you cannot derive — do not deepen the idea.

**Good questions:**
- "What made you think of this now?"
- "Where in the codebase do you see this applying — a widget, the course content, the presentation mode?"
- "Is there a specific scenario you have in mind?"

**Bad questions (these belong in Process B, not here):**
- "What are the acceptance criteria?"
- "How would you implement this?"
- "Should this be split into slices?"
- "What is the priority?"

If the description is already clear (what + why + where), skip directly to Step 2 without asking.

### Step 2 — Detect duplicates

Before drafting, query existing Discussions in `💡 Ideas` for matches. Use simple keyword matching against title and body.

Run:

```bash
gh api graphql -f query='
query {
  repository(owner: "so77id", name: "nalanda") {
    discussions(first: 100, categoryId: "DIC_kwDOSGlAqc4C9bBm", states: [OPEN]) {
      nodes { number title body url }
    }
  }
}'
```

Rank existing discussions by:
1. Word overlap with proposed title.
2. Word overlap with proposed body keywords.
3. Same `area:*` label inferred for both.

If you find 1+ matches with significant overlap (≥3 keywords or strong title similarity), **show top 3 to the user** and ask:

> Found similar idea(s):
> 1. #N — <title> (<url>)
> 2. #M — <title>
>
> Options: (a) create new anyway, (b) add this as a comment to existing, (c) edit the existing body to consolidate.

Wait for the user's choice before proceeding.

If no matches, continue silently to Step 3.

### Step 3 — Draft

Build the Discussion content:

**Title format:** `<verb>: <object>` in imperative, English, ≤80 chars.

Examples:
- `Add graph DS visualizer with BFS/DFS animations`
- `Investigate Pyodide for in-browser Python execution`
- `Fix CodeMirror line-tracker desync with visualizer`

**Body template** (English, markdown):

```markdown
## Idea
<one-paragraph summary of what the user proposes, in their own words but cleaned up>

## Context
<one-paragraph why-now: trigger, scenario, what motivated the idea>

## Notes
<optional: constraints, references to existing code, tradeoffs the user mentioned>
```

If `Notes` is empty, omit the section entirely.

**Inferred labels:**
- One `type:*` from {bug, feature, refactor, docs, chore} based on the idea's nature.
- One or more `area:*` from {widgets, course, presentation, runtime, infra, docs} based on the modules touched.

If you are unsure about a label, ask once: "I'd label this `type:feature` and `area:widgets` — does that fit?". If you are confident, do not ask.

### Step 4 — Confirm with user

Show the draft inline:

```
Title: <title>

<body>

Labels: type:<x>, area:<y>
```

Ask: "Save it like this?". The user replies with one of:
- "yes" / "ok" / "go" → proceed to Step 5.
- An edit ("change the title to..." / "drop the area label") → adjust and re-show.
- "no" / "cancel" → abort and confirm.

### Step 5 — Save

Create the Discussion via GraphQL:

```bash
gh api graphql -f query='
mutation($title: String!, $body: String!) {
  createDiscussion(input: {
    repositoryId: "R_kgDOSGlAqQ",
    categoryId: "DIC_kwDOSGlAqc4C9bBm",
    title: $title,
    body: $body
  }) {
    discussion { id number url }
  }
}' -f title="<TITLE>" -f body="<BODY>"
```

Capture the returned `discussion.id` and `discussion.number`.

Then add labels using `addLabelsToLabelable`. First fetch label IDs (cache them across captures within the same session):

```bash
gh api graphql -f query='
query {
  repository(owner: "so77id", name: "nalanda") {
    labels(first: 30) { nodes { id name } }
  }
}'
```

Then attach the inferred labels:

```bash
gh api graphql -f query='
mutation($labelable: ID!, $labels: [ID!]!) {
  addLabelsToLabelable(input: { labelableId: $labelable, labelIds: $labels }) {
    labelable { ... on Discussion { id labels(first: 5) { nodes { name } } } }
  }
}' -f labelable="<DISCUSSION_ID>" -F labels="<LABEL_IDS_ARRAY>"
```

If saving fails (network, auth, rate limit), report the error to the user with the draft preserved so they can retry.

### Step 6 — Confirm save and close

Tell the user:

```
Saved → #<N>: <title>
URL: <url>
```

Then ask: "Another idea, or back to what we were doing?"

If "another" → restart at Step 1.
If "back" or anything else → return to the prior conversational context **without** restating it. Do not summarize the previous topic; the user remembers it.

## Edge cases

### Trivial idea (one sentence, low scope)

Capture anyway. Consistency matters more than ceremony. The Discussion may be empty in `Notes` and have only `Idea` + `Context`. That is acceptable.

### Existing match for the duplicate-detection options

- **Option (b) "add as comment":** post a comment on the existing Discussion with the new content. Use `addDiscussionComment` mutation. Body of the comment should include `> Added on YYYY-MM-DD: ` prefix to mark when.
- **Option (c) "edit existing":** use `updateDiscussion` mutation to replace the body. Preserve the original by appending a `## Update YYYY-MM-DD` section instead of overwriting.

### User describes multiple ideas at once

If the user packs 2+ distinct ideas into a single message, ask: "I see 2 ideas here — capture them separately or combine?". Default to separate if uncertain.

### Idea references a specific code location

If the user mentions a file or symbol (e.g., `src/widgets/code-editor/CodeEditor.jsx:120`), include it in `Notes` verbatim. Do not try to verify the line is still accurate — just preserve the reference.

### User cancels mid-flow

If the user says "cancel" or "skip" at any point, abort cleanly: confirm "Got it, not saving" and return to prior context.

### `gh` command fails

- **Auth error:** ask the user to run `gh auth login` or `gh auth status`.
- **Network error:** retry once after a brief pause; if still failing, surface the error and ask the user to retry later.
- **Rate limit:** report and pause; do not loop.

## Output format reference

A complete saved Discussion looks like:

```
Title: Add graph DS visualizer with BFS/DFS animations

## Idea
Build a new widget that visualizes graph traversal step by step.
Reuses the visualizer scaffold but adds adjacency-list rendering
and edge highlighting on each BFS/DFS frame.

## Context
The course already has stack, queue, and BST visualizers. The next
chapter introduces graphs and there is no widget that covers it.

## Notes
- Reuse existing visualizer base in src/widgets/
- Confirm framer-motion can animate edges performantly with N=50 nodes

Labels: type:feature, area:widgets
```

## Operational quick reference

| Action | Command |
|---|---|
| List discussions in Ideas | `gh api graphql -f query='...discussions(categoryId:"DIC_kwDOSGlAqc4C9bBm")...'` |
| Create discussion | `gh api graphql -f query='mutation { createDiscussion(...) { ... } }'` |
| Comment on discussion | `gh api graphql -f query='mutation { addDiscussionComment(...) { ... } }'` |
| Update discussion | `gh api graphql -f query='mutation { updateDiscussion(...) { ... } }'` |
| Add labels | `gh api graphql -f query='mutation { addLabelsToLabelable(...) { ... } }'` |
| Fetch label IDs | `gh api graphql -f query='query { repository(...) { labels { nodes { id name } } } }'` |
