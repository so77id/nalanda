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
├── docs/
│   ├── standards/      Dev standards: repo structure, code style, testing, docs
│   ├── design/         Design narratives (2026-08 redesign)
│   ├── decisions/      ADRs, numbered sequentially
│   ├── conventions.md  Workflow conventions (kanban, branches, commits, PRs)
│   └── course-graph.md Course topology (planning tool)
├── proof-of-concept/   Archived POC + old roadmap issues (reference)
├── .claude/            Agent workflow skills
└── CLAUDE.md           Monorepo-shared agent instructions (per-app CLAUDE.md in each app)
```

Future directories (`content/`, `infra/`, `packages/`, `e2e/`) are defined in
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

## Workflow

All changes go through PRs (squash-merged manually). See
[`docs/conventions.md`](docs/conventions.md) for branch naming, commit format,
kanban columns, and the WP lifecycle.
