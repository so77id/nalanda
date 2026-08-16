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
| Add a language runtime | [`guides/add-a-language-runtime.md`](guides/add-a-language-runtime.md) | Teaching the platform a new executable language: worker contract, registry, CDN vs self-hosting, browser verification |
| Write control questions | [`guides/write-control-questions.md`](guides/write-control-questions.md) | Writing the questions at the end of a course document: the rules the suite enforces, the ones only a human can, and worked examples of both — read before drafting any, with an agent or by hand |
| Drive the control engine | [`../../apps/amc-worker/README.md`](../../apps/amc-worker/README.md) | Calling `apps/amc-worker`: the HTTP contract, the shared-volume convention, and the four silent AMC traps a caller must not hit (ADR-0030) |
| Verify the control engine on paper | [`../../apps/amc-worker/PAPER-CHECK.md`](../../apps/amc-worker/PAPER-CHECK.md) | The one check no agent can run: print, mark, scan, read, compare. Required before trusting a synthetic green run |

## Pending guides (registered by the WP that creates the extension point)

| Guide | Arrives with | Will cover |
|---|---|---|
| Add a session event type | v0.3 — live sessions | Envelope protocol, emit/consume declaration, relay transparency |
| Add a backend endpoint | v0.3 — `apps/server` | Handler + repository + tests pattern |

## Guide format

A guide lives in one of three places: a section in a standard, its own file
under `docs/standards/guides/`, or — when the extension point IS an app — a file
inside that app, so it sits beside the code it must not drift from (worked case:
`apps/amc-worker`, #138). Each contains:

1. **When to use** — the situation that calls for this extension.
2. **Worked example** — a real, complete case with actual file paths.
3. **Step-by-step** — ordered, concrete, no hand-waving.
4. **Checklist** — everything that must be true before the PR opens (code, tests
   per `testing-strategy.md`, docs per `documentation.md`).
