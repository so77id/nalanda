# Integration Guides — Index

Walkthroughs for Nalanda's extension points, in the style proven by DocumentBuddy's
`docs/extending/`: each guide walks one extension end-to-end with a worked example
and a checklist. **Every WP that creates a new extension point must register its
guide here** (ADR-0005).

## Available guides

| Guide | Where | When to read |
|---|---|---|
| Add a new app to the monorepo | `repository-structure.md` § "How to add a new app" | Creating `apps/server` or any future app |
| Add a course document | [`guides/add-a-course-document.md`](guides/add-a-course-document.md) | Writing course material: MDX frontmatter contract, wiki-links, index registration |
| Add a content component | [`guides/add-a-content-component.md`](guides/add-a-content-component.md) | New document-facing component: contract, catalog entry, families, review checklist |

## Pending guides (registered by the WP that creates the extension point)

| Guide | Arrives with | Will cover |
|---|---|---|
| Add a session event type | v0.3 — live sessions | Envelope protocol, emit/consume declaration, relay transparency |
| Add a backend endpoint | v0.3 — `apps/server` | Handler + repository + tests pattern |

## Guide format

Each guide (a section in a standard, or its own file under `docs/standards/guides/`
once they grow) contains:

1. **When to use** — the situation that calls for this extension.
2. **Worked example** — a real, complete case with actual file paths.
3. **Step-by-step** — ordered, concrete, no hand-waving.
4. **Checklist** — everything that must be true before the PR opens (code, tests
   per `testing-strategy.md`, docs per `documentation.md`).
