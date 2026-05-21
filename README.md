# Nalanda

Interactive CS learning platform. Browser-first site where theory, slides, data-structure visualizations, and live code execution coexist. MVP course: *Data Structures in C++*.

## Monorepo layout

```
nalanda/
├── apps/
│   └── frontend/   React 19 + Vite POC (course site, widgets, smoke tests)
├── packages/       (placeholder) shared libraries — e.g., OpenAPI client (S1.3)
├── infra/          (placeholder) Terraform modules (S1.4)
├── scripts/        (placeholder) local dev helpers (S1.6)
├── docs/           ADRs, conventions, plans
├── .claude/        agent skills + workflow infra
└── CLAUDE.md       root project instructions
```

## Development

The frontend lives in `apps/frontend/`. All commands run from there:

```bash
cd apps/frontend
npm install
npm run dev      # Vite dev server (localhost:5173)
npm run build    # Production build to apps/frontend/dist/
npm run preview  # Preview the production build
npm run lint     # ESLint

node smoke/smoke-test-stack.mjs   # Run any smoke test against npm run dev
```

## Workflow

All changes go through PRs (squash-merged manually). See `docs/conventions.md` for branch naming, commit format, kanban columns, and the WP lifecycle. The agent workflow skills live in `.claude/skills/` (`capture-idea`, `refine-idea`, `groom-backlog`, `develop-task`).

## Architecture

Active architectural decisions are in `docs/decisions/`. The current SPA POC is described in `CLAUDE.md`; the platform plan and ADR-0001 cover the upcoming Go backend, shared OpenAPI contracts, and Terraform infrastructure.
