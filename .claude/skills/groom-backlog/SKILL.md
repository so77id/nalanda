---
name: groom-backlog
description: Promote issues from the Backlog column to Ready on the GitHub Project board for so77id/nalanda. Facilitates the mechanics — listing, grouping, filtering, selection, and movement — without recommending which issues to promote. Triggers on `/groom-backlog`, `/groom`, or natural-language phrases like "let's fill Ready", "review the backlog", "vamos a llenar Ready", "promovamos algo".
---

# groom-backlog — Process D

List the Backlog and let the user pick which issues to promote to Ready. The agent's role is purely mechanical: fetch, present, move. It does **not** recommend, prioritize, or impose criteria — those decisions belong to the user.

## When to invoke

- The user types `/groom-backlog` or `/groom`.
- The user says: "let's fill Ready", "promote some issues", "vamos a llenar Ready", "revisemos backlog", "groom the backlog".
- Do **not** invoke when the user wants to capture (Process A), refine (Process B), or develop (Process C).

## Constants (from `docs/conventions.md`)

```
Project number:    3
Project ID:        PVT_kwHOAD5lg84BYOfH
Status field ID:   PVTSSF_lAHOAD5lg84BYOfHzhTVzpo
  Backlog     → 3876d811
  Ready       → d471aa12
  In Progress → 709335dd
  Review      → 4bbf67b2
  Done        → 374a7858
```

## Phase 1 — Fetch the Backlog

```bash
gh project item-list 3 --owner so77id --format json --limit 200
```

Filter the response to items with `status: "Backlog"`. For each item, capture:

- Issue number
- Title
- Labels (especially `type:*` and `area:*`)
- URL
- Source (extract from issue body if present, e.g., "Discussion #N", "Audit ...")
- Created date (or last updated)

## Phase 2 — Present the list

### Default: group by `type`

Group items by the value of their `type:*` label. Within each group, list items oldest-first (so older issues are visible at the top).

Format example:

```
Backlog (12 items)

▸ refactor (5)
  #42  Extract code-editor variants                  [discussion:#15] (3w)
  #45  Decouple visualizer base from BST              (2w)
  ...

▸ feature (4)
  #87  Add graph DS visualizer                        (1w)
  ...

▸ chore (2)
  #103 Tighten ESLint config                          (4d)
  #78  Re-record cover screenshots                    (5d)

▸ docs (1)
  #99  ADR for presentation-mode lifecycle            (3d)
```

Always show: count per group, total count, and the relative age in parentheses.

### Alternative groupings (on request)

The user can ask for other groupings. Honor verbatim:

| Request | Grouping |
|---|---|
| "group by area" | Group by `area:*` label |
| "group by source" | Group by source kind (discussion / audit / fresh / migration) |
| "by age" | Flat list sorted oldest-first |
| "by number" | Flat list sorted by issue number |

### Filters (basic)

The user can request basic filters; combine them with the current grouping:

| Request | Filter |
|---|---|
| "only discussion items" | items where source mentions "Discussion" |
| "only `area:widgets`" (or any area) | items with that area label |
| "only `type:bug`" (or any type) | items with that type label |
| "exclude chore" | omit items labeled `type:chore` |

If the user asks for a filter the agent cannot apply mechanically, surface: "I cannot filter by <X> — what specific labels or fields should I match?".

## Phase 3 — Selection

The user picks items by:

- **Issue number list**: "promote #42 #45 #51"
- **Top N from a group**: "the top 3 from refactor", "first 2 by age"
- **All of a category**: "all `area:widgets` to Ready"
- **Description match**: "the one about graphs" — agent confirms by showing matched item

If selection is ambiguous, agent shows candidates and asks for confirmation.

## Phase 4 — Move to Ready

For each selected item:

```bash
# Get the project item ID for the issue (already fetched in Phase 1; reuse).
gh project item-edit \
  --project-id PVT_kwHOAD5lg84BYOfH \
  --id <PROJECT_ITEM_ID> \
  --field-id PVTSSF_lAHOAD5lg84BYOfHzhTVzpo \
  --single-select-option-id d471aa12
```

If a move fails (rate limit, transient error), report the failure with the issue number; continue with the rest. Do not silently skip.

## Phase 5 — Confirm

Tell the user:

```
Promoted to Ready:
  #42 — Extract code-editor variants
  #45 — Decouple visualizer base from BST
  #51 — Fix CodeMirror desync

Ready now contains 5 items:
  (re-list Ready column briefly)
```

Then: "Anything else, or done?".

## Auxiliary mechanics

These are extensions of the same mechanical role.

### Demote (Ready → Backlog)

User says: "demote #N", "move #N back to Backlog".

```bash
gh project item-edit \
  --project-id PVT_kwHOAD5lg84BYOfH \
  --id <PROJECT_ITEM_ID> \
  --field-id PVTSSF_lAHOAD5lg84BYOfHzhTVzpo \
  --single-select-option-id 3876d811
```

### Reorder Ready

GitHub Projects v2 supports item reordering via `gh api graphql` with `updateProjectV2ItemPosition` mutation. Use it on user request: "put #51 before #42".

```bash
gh api graphql -f query='
mutation {
  updateProjectV2ItemPosition(input: {
    projectId: "PVT_kwHOAD5lg84BYOfH",
    itemId: "<ITEM_ID>",
    afterId: "<ITEM_ID_TO_PLACE_AFTER>"  # or null to put at top
  }) {
    items { totalCount }
  }
}'
```

### Inspect

User says: "show me #N", "what's #N about?".

```bash
gh issue view <N> --repo so77id/nalanda
```

Show body inline so the user does not need to open the browser.

### Bulk

User says: "all `area:widgets` to Ready", "all discussion items to Ready".

Apply the filter, list matching items for confirmation, then move all on user approval.

## Edge cases

### Backlog is empty

Tell the user: "Backlog is empty. Capture or refine new ideas first.".

### Ready already has many items

By design (per `docs/conventions.md`), Ready has no hard limit. If Ready already has many items (say, >10), surface a friendly note: "Ready already has 11 items — sure you want more?". User decides; do not block.

### Selection includes items already in Ready

Detect duplicates and skip them with a note: "#42 is already in Ready, skipping.".

### Issue number does not exist or is not on the board

Surface: "#999 is not on the project board. Add it first via Process B (refine).".

### Source field missing

If an issue body has no `Source:` line, display source as `—` in the list. Do not block.

## Operational quick reference

| Action | Command |
|---|---|
| List items | `gh project item-list 3 --owner so77id --format json --limit 200` |
| View issue | `gh issue view <N> --repo so77id/nalanda` |
| Move column | `gh project item-edit --project-id ... --id ... --field-id ... --single-select-option-id ...` |
| Reorder item | `gh api graphql -f query='mutation { updateProjectV2ItemPosition(...) { ... } }'` |
| Search Backlog | `gh project item-list ... --format json` then filter by status and labels in agent |
