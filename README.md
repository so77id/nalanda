# Nalanda

Interactive CS learning platform. Browser-first site where theory, slides,
data-structure visualizations, and live code execution coexist.

## Status (August 2026)

Building **v0.1 "El esqueleto"** of the from-zero redesign: monorepo foundation,
content model (MDX wiki + teaching index), presentation mode, component catalog,
and static deploy. Roadmap and design narrative:
[`docs/design/2026-08-redesign.md`](docs/design/2026-08-redesign.md) · living
decisions: [`docs/decisions/`](docs/decisions/).

The original proof of concept (8 DS visualizers, in-browser C++/Python execution,
presentation mode) is archived under
[`proof-of-concept/`](proof-of-concept/README.md) — still runnable, mined piece by
piece as the new app needs it.

## Repository layout

```
nalanda/
├── apps/
│   └── web/            Platform frontend (React 19 + TS + Vite + Tailwind v4)
├── content/            Course material (Material domain): courses/<slug>/ — MDX + index.yaml
├── docs/
│   ├── standards/      Dev standards: repo structure, code style, testing, docs
│   ├── design/         Design narratives (2026-08 redesign)
│   ├── decisions/      ADRs, numbered sequentially
│   ├── conventions.md  Workflow conventions (kanban, branches, commits, PRs)
│   ├── security-notes.md  Security deferrals / accepted-risk records
│   └── course-graph.md Course topology (planning tool)
├── proof-of-concept/   Archived POC + old roadmap issues (reference)
├── .claude/            Agent infra: workflow bindings, settings (plugins), hooks, repo agents
└── CLAUDE.md           Monorepo-shared agent instructions (per-app CLAUDE.md in each app)
```

Future directories (`infra/`, `packages/`, `e2e/`) are defined in
[`docs/standards/repository-structure.md`](docs/standards/repository-structure.md)
and created when their first real content arrives.

## Development

```bash
cd apps/web
npm install
npm run dev      # localhost:5173
```

Full command list and app-specific rules: [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md)
and [`apps/web/README.md`](apps/web/README.md). Before contributing, read
[`docs/standards/`](docs/standards/) — especially the two testing protocols
(per-commit and pre-PR) in `testing-strategy.md`.

## Deployment

The site is live at **<https://so77id.github.io/nalanda/>** (GitHub Pages, free
project-pages URL — a custom domain would only change the Vite `base`).

- **What publishes it**: `.github/workflows/deploy.yml`, on every push to `main`
  that touches `apps/web/**`, `content/**` or the workflow itself. Course
  material lives outside `apps/` (ADR-0002), so writing a class republishes the
  site; a docs-only commit does not. It can also be run by hand from the Actions
  tab (`workflow_dispatch`) without committing anything.
- **How deep links survive**: Pages is a static file server, so
  `/nalanda/d/bienvenida` has no file behind it. The build copies `index.html`
  to `404.html` (`apps/web/src/app/spaFallback.ts`), which Pages serves for
  unknown paths, handing the URL to the router.
- **How to verify after a deploy**: open `/nalanda/`, one deep document link
  (e.g. `/nalanda/d/busqueda-binaria`), and `/nalanda/catalog`. Locally,
  `npm run build && npm run preview` serves the real build under `/nalanda/` and
  proves the base path and the router basename — but NOT the fallback, because
  `vite preview` has its own SPA fallback that masks a missing `404.html`. That
  mechanism is guarded by tests instead (`apps/web/src/app/spaFallback.test.ts`).
- **What gets published**: every `.mdx` under `content/courses/**` — the index
  only controls navigation (see `docs/security-notes.md`).
- **Rollback**: revert the offending commit on `main`. The revert is itself a
  push to `main`, so it redeploys the previous version — there is no separate
  deploy button to press.

## Workflow

All changes go through PRs (squash-merged manually). See
[`docs/conventions.md`](docs/conventions.md) for branch naming, commit format,
kanban columns, and the WP lifecycle.
