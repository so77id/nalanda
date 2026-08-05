# Nalanda

Interactive CS learning platform. Browser-first site where theory, slides,
data-structure visualizations, and live code execution coexist.

## Status (August 2026)

The project is in a **from-zero redesign**: the aspirational platform (live classes,
course creator, client-side code execution) is being designed before any new
implementation starts. The living design document is
[`docs/design/2026-08-redesign.md`](docs/design/2026-08-redesign.md).

The original proof of concept (8 DS visualizers, in-browser C++/Python execution,
presentation mode) and the discarded May 2026 roadmap are packaged under
[`proof-of-concept/`](proof-of-concept/README.md) — still runnable, kept as reference.

## Repository layout

```
nalanda/
├── proof-of-concept/   Archived POC app + documented issues from the old roadmap
├── docs/
│   ├── design/         Living redesign document (design narrative + roadmap)
│   ├── decisions/      ADRs 0001–0010 — the living architectural decisions
│   ├── conventions.md  Workflow conventions (branches, commits, PRs, kanban)
│   └── course-graph.md Course topology (deferred until platform v0.1)
├── .claude/            Agent workflow skills (capture-idea, refine-idea, groom-backlog, develop-task)
└── CLAUDE.md           Root project instructions
```

## Workflow

All changes go through PRs (squash-merged manually). See `docs/conventions.md` for
branch naming, commit format, kanban columns, and the WP lifecycle.
