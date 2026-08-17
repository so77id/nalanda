# CLAUDE.md — Nalanda

## Description
Interactive CS learning platform: theory, presentation, interactive visualizations,
and live code execution in one browser-first site. **v0.1 "El esqueleto" is
complete and live at <https://so77id.github.io/nalanda/>**; work moves to v0.2
"El contenido vivo".

**The backend was pulled forward out of v0.3** (ADR-0034): the entrance-controls
subsystem needs server work that cannot happen in a browser, so `apps/server`
exists now. The site is still browser-first and still deploys as a static build —
nothing in `apps/web` talks to the server yet.

This file holds **monorepo-shared** instructions only. Each app has its own
`CLAUDE.md` with its commands, stack, and rules — read it before working there:

- `apps/web/CLAUDE.md` — the platform frontend.
- `apps/amc-worker/CLAUDE.md` — the control engine (Auto-Multiple-Choice in a
  container). Nothing there runs on the host; everything goes through Docker.
- `apps/server/CLAUDE.md` — the backend (Go + SQLite). One binary, two delivery
  surfaces, one shared domain; its dependency rule is enforced by a test. The
  professor login lives there (ADR-0009, ADR-0036) and the two surfaces
  deliberately do not share an auth gate. **First production deploy: the
  Jetson (ADR-0037), operating procedure `infra/local/DEPLOY-JETSON.md`; the
  host-specific images and scripts live under `infra/deploy/jetson/`.**

## Mandatory reading (before any code work)

- `docs/standards/repository-structure.md` — layout, placement criteria, how to add an app.
- `docs/standards/<relevant>-code-style.md` — bounded style; agents follow, don't innovate.
- `docs/standards/testing-strategy.md` — the two protocols (per-commit, pre-PR).
- `docs/standards/documentation.md` — where each kind of knowledge lives.
- `docs/decisions/` — ADRs, numbered sequentially (living architectural decisions).
- `docs/design/2026-08-redesign.md` — design narrative + roadmap (v0.1 → v0.3).
- `docs/design/2026-08-controles.md` — entrance-controls subsystem: closed
  decisions, the WP map, and why it pulls the v0.3 backend forward.
- `docs/standards/guides/add-a-course-document.md` — **read before editing
  anything under `content/`**: the frontmatter contract, the slide markers, and
  the fact that everything there is published (the index controls navigation,
  never visibility).

The original POC is archived in `proof-of-concept/` (runnable, reference only —
port pieces from it as WPs require, refactoring to current standards on entry).

## Language
All code, comments, identifiers, commit messages, and repo documentation in
**English**. **Everything the reader can perceive is Spanish** — course content,
visible UI chrome, and equally the accessible names (`aria-label`, `sr-only`,
live-region text): the page is served `lang="es"`, so an English accessible name
is announced with Spanish phonemes, which is the same defect `lang` itself was
set to avoid (`app/documentShell.test.ts`). English stays inside identifiers,
props, `data-testid` and test titles — and in `/catalog`, which ships with the
site but addresses component authors, not students (`documentation.md`
§Component governance). That exception stops at the live examples: a component
page runs the real component, so its snippets and the widget's own chrome are
course content and stay Spanish (`documentation.md` Rule 5).

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
- **Merging to `main` also publishes `apps/server` to the Jetson.**
  `.github/workflows/server-cd.yml` cross-compiles three arm64 images
  (server + backup + monitor), pushes them to
  `ghcr.io/so77id/nalanda-*:latest`, and Watchtower on the Jetson (the
  one running inside DocumentBuddy's compose) pulls and restarts within
  ≤5 minutes. Path filters: `apps/server/**` or
  `infra/deploy/jetson/{Dockerfile.*,*.sh}`. A change to the login path
  (the OIDC adapter, the callback, a cookie, `NALANDA_PUBLIC_URL`) is
  unfinished until [`apps/server/GOOGLE-CHECK.md`](apps/server/GOOGLE-CHECK.md)
  runs against the https URL (its §7 observes the `Secure` flag on the
  wire). Mechanics and decisions: root `README.md` §"apps/server on the
  Jetson", operating procedure `infra/local/DEPLOY-JETSON.md`, ADR-0037.
- **All changes go through PRs** — never push directly to `main`.
- **Squash merge** is mandatory for every PR (manual, by the user).
- **One commit per slice**; the slice list lives in the issue body as checkboxes.
- **Green before commit**: the app's per-commit protocol (see
  `docs/standards/testing-strategy.md`) passes before every commit. The pre-PR
  protocol passes before publishing any PR.
- **Trivial fixes** (≤3 lines, no logic, negligible risk) may bypass the system —
  see `docs/conventions.md` "yolo mode".

### References

- Workflow conventions (kanban, labels, branches, commits, slice planning, PR
  template, worktrees):
  `docs/conventions.md`
- ADR format and when to write one: `docs/standards/documentation.md` (§Rules 2 + §ADR format)

## Rules for Claude (repo-wide)

- Never modify dependency manifests without discussing first — `package.json`,
  `apps/server/go.mod` (with `go.sum` as its lockfile), and the apt and TeX Live
  set in `apps/amc-worker/Dockerfile` (which is that app's manifest); never touch
  lockfiles by hand.
- Never commit `node_modules/`, `dist/`, or `.env` files.
- Documentation ships in the same PR as the change that obligates it
  (`docs/standards/documentation.md`).
- For UI changes, verify in a real browser before reporting done — protocols and
  lint verify code correctness, not feature correctness. Anything touching
  paths, assets or routing must be checked with `npm run build && npm run
  preview` (serves under `/nalanda/`, like production), not only `npm run dev`
  (serves at `/`).
