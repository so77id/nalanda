# CLAUDE.md — Nalanda

## Description
Interactive CS learning platform: theory, presentation, interactive visualizations,
and live code execution in one browser-first site. **v0.1 "El esqueleto" is
complete and live at <https://so77id.github.io/nalanda/>**; work moves to v0.2
"El contenido vivo".

This file holds **monorepo-shared** instructions only. Each app has its own
`CLAUDE.md` with its commands, stack, and rules — read it before working there:

- `apps/web/CLAUDE.md` — the platform frontend.

## Mandatory reading (before any code work)

- `docs/standards/repository-structure.md` — layout, placement criteria, how to add an app.
- `docs/standards/<relevant>-code-style.md` — bounded style; agents follow, don't innovate.
- `docs/standards/testing-strategy.md` — the two protocols (per-commit, pre-PR).
- `docs/standards/documentation.md` — where each kind of knowledge lives.
- `docs/decisions/` — ADRs, numbered sequentially (living architectural decisions).
- `docs/design/2026-08-redesign.md` — design narrative + roadmap (v0.1 → v0.3).

The original POC is archived in `proof-of-concept/` (runnable, reference only —
port pieces from it as WPs require, refactoring to current standards on entry).

## Language
All code, comments, identifiers, commit messages, and repo documentation in
**English**. User-facing course content may be in Spanish.

## Development Workflow

Four processes manage development, provided by the **`agentic-workflow` plugin**
(marketplace + plugin declared in `.claude/settings.json`; repo-specific IDs and
paths in `.claude/workflow-bindings.md`, regenerable via `/init-workflow`):

- **Capture an idea** → `capture-idea` (Discussion in 💡 Ideas)
- **Refine an idea into a WP** → `refine-idea` (Issue in Backlog, full body)
- **Develop a WP into a PR** → `develop-task` (worktree + TDD slices + review pipeline + PR)
- **Promote Backlog → Ready** → `groom-backlog`
- **Review any diff** → `review-pipeline` (multi-agent panels + adversarial verifier)

Every plugin skill reads `.claude/workflow-bindings.md` first; global workflow
rules live in the plugin's `docs/defaults.md`. Engineering-practice doctrine
(TDD, spec, incremental implementation, domain reviews) comes from the
`agent-skills` plugin — both install automatically from the settings declaration.

### Hard rules

- **Merging to `main` publishes the site.** `.github/workflows/deploy.yml`
  deploys `apps/web` to <https://so77id.github.io/nalanda/> on every push to
  `main` touching `apps/web/**` or `content/**`. Mechanics (trigger, deep-link
  fallback, rollback, what gets published): root `README.md` §Deployment;
  decisions: ADR-0015.
- **All changes go through PRs** — never push directly to `main`.
- **Squash merge** is mandatory for every PR (manual, by the user).
- **One commit per slice**; the slice list lives in the issue body as checkboxes.
- **Green before commit**: the app's per-commit protocol (see
  `docs/standards/testing-strategy.md`) passes before every commit. The pre-PR
  protocol passes before publishing any PR.
- **Trivial fixes** (≤3 lines, no logic, negligible risk) may bypass the system —
  see `docs/conventions.md` "yolo mode".

### References

- Workflow conventions (kanban, labels, branches, commits, PR template, worktrees):
  `docs/conventions.md`
- ADR format and when to write one: `docs/standards/documentation.md` (§Rules 2 + §ADR format)

## Rules for Claude (repo-wide)

- Never modify dependency manifests (`package.json`, future `go.mod`) without
  discussing first; never touch lockfiles by hand.
- Never commit `node_modules/`, `dist/`, or `.env` files.
- Documentation ships in the same PR as the change that obligates it
  (`docs/standards/documentation.md`).
- For UI changes, verify in a real browser before reporting done — protocols and
  lint verify code correctness, not feature correctness. Anything touching
  paths, assets or routing must be checked with `npm run build && npm run
  preview` (serves under `/nalanda/`, like production), not only `npm run dev`
  (serves at `/`).
