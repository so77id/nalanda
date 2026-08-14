# Repository Structure

Source of truth for how the Nalanda monorepo is organized: the taxonomy, the
structural principles, where things go, and how to add a new application. Agents
and humans follow this document; deviations are proposed in PRs and recorded here.

## Layout

```
nalanda/
├── apps/                    # deployable applications, each SELF-CONTAINED
│   └── web/                 # platform frontend (React + TS + Vite)
│                            # server/ arrives in v0.3 (Go) — created when it arrives
├── content/                 # course material (Material domain) — created by its first course
│   └── courses/<slug>/...   # v0.1: exactly ONE course (enforced at app startup)
├── packages/                # shared libraries between apps — created with the first one
├── docs/
│   ├── standards/           # bounded dev standards (this document and siblings)
│   ├── design/              # design narratives (e.g., 2026-08 redesign)
│   ├── decisions/           # ADRs — living architectural decisions
│   ├── graphs/              # course topology diagrams (companion to course-graph.md)
│   ├── conventions.md       # workflow conventions (kanban, branches, commits, PRs)
│   ├── security-notes.md    # security deferrals / accepted-risk records
│   └── course-graph.md      # course topology (planning tool)
├── infra/                   # running the system around the apps (see below)
├── proof-of-concept/        # archived 2025/May-2026 POC — reference only, never active work
├── .github/                 # CI/CD workflows
├── .claude/                 # agent infra: workflow-bindings.md, settings (plugin declarations), hooks, repo-specific agents — workflow skills come from the agentic-workflow plugin
├── CLAUDE.md                # monorepo-shared agent instructions (per-app CLAUDE.md in each app)
└── README.md
```

## Principles

1. **No directory exists empty.** A directory is created together with its first
   real content. No `.gitkeep` placeholders, no "reserved" empty trees. (This is
   why `infra/`, `packages/`, `e2e/` may not exist yet — they are defined here,
   born when needed.)
2. **Each app is self-contained.** Own manifest (`package.json` / `go.mod`), own
   README with install/dev/test/build commands, own `CLAUDE.md`, own tests, own
   packaging (Dockerfile lives in the app). Someone cloning the repo must be able
   to work on one app reading only that app + the standards.
3. **Fixed taxonomy.**
   - `apps/` — deployables.
   - `packages/` — code shared by two or more apps. Nothing is "promoted" here
     speculatively; a second consumer is the admission ticket.
   - `content/` — course material (Material domain). Not app code: it has its own
     lifecycle (authoring), its own future (database, per ADR-0002), and is edited
     without entering any `src/`.

     **In v0.1 it is also the test suite's fixture set, and that is a real
     constraint on authoring, not just a note.** Several tests assert over the
     live registry because there is no other real content to assert over. The
     cost has already been paid once: since #108, `01-bienvenida.mdx` declares
     `presentation: auto` rather than the `none` its content argues for, purely
     because it is the suite's only `auto` document. A declaration chosen for the
     suite rather than for the reader is the line this crosses — ADR-0013 §4
     accepts content-as-fixture, but there the fixture role and the content's
     intent agreed. Editing `content/` therefore requires the full suite, not
     only the build (`guides/add-a-course-document.md` §presentation). The exit
     is a dedicated fixture course plus registry injection — `buildRegistry` is
     already parameterised; what blocks it is that the shell reaches
     `liveContent` at module scope. Its own WP when the cost justifies it.

   - `docs/` — knowledge: standards, design, decisions, conventions.
   - `infra/` — running the system around the apps:
     - `infra/local/` — local orchestration (docker-compose, multi-app Makefile)
       and runnable dev mocks of external services.
     - `infra/deploy/` — host provisioning, reverse-proxy/systemd config,
       production compose. Apps package themselves; infra _places_ them.

## Placement criteria — "where does X go"

| Thing                                                                             | Where                                                                       | Why                                                                                               |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local orchestration (docker-compose / multi-app Makefile)                         | `infra/local/`                                                              | Coordinates apps; belongs to none                                                                 |
| Runnable dev mock of an external service (fake university API, fake OAuth server) | `infra/local/mocks/`                                                        | Exists to run the system locally, not to test                                                     |
| Test fakes/mocks (in-process, used by tests)                                      | Next to the tests, inside their app                                         | Test code                                                                                         |
| Dockerfile / packaging of one app                                                 | Inside that app                                                             | The app packages itself; infra places it                                                          |
| VPS provisioning, systemd/proxy config, production compose                        | `infra/deploy/`                                                             | Belongs to the host, not to an app                                                                |
| One app's integration tests                                                       | In that app                                                                 | They verify ITS behavior                                                                          |
| Cross-app e2e (browser → web → server)                                            | Top-level `e2e/` (created when it first exists)                             | Verifies the whole                                                                                |
| Course assets (images/video)                                                      | `content/`, next to their documents                                         | Material domain                                                                                   |
| Test mocks needed by a second app                                                 | Promote to `packages/`                                                      | Shared-code rule                                                                                  |
| Build script (fetches or generates a build input)                                 | `apps/<app>/scripts/`, wired to an npm lifecycle hook (`prebuild`/`predev`) | Neither source nor runtime code; must run before the bundler, and in CI                           |
| Fetched or generated build input (jar, wasm blob)                                 | That app's `public/`, gitignored, digest pinned in the fetching script      | Reproducible without carrying binaries in git — worked case `public/java-compiler.jar` (ADR-0017) |

**Growth rule:** when a new case has no row in this table, propose a placement in
the PR that introduces it and record the outcome here in the same PR. The standard
grows case by case — it is self-governing, like the component catalog.

## How to add a new app

Checklist for any new application under `apps/` (e.g., `apps/server` in v0.3):

- [ ] Own `README.md` with install / dev / test / build commands — the app is
      understandable alone.
- [ ] Own `CLAUDE.md`: agent rules + pointers to its standards docs (commands
      and stack live in the app README — one home per fact). In the
      same change, edit the **root** `CLAUDE.md` so monorepo-shared concerns stay
      at root and app-specific concerns live in the app — no duplication.
- [ ] Own CI job with **path filters**: changes under `apps/<name>/**` trigger only
      that app's pipeline.
- [ ] If the app is user-facing, its **publication** wired into
      `.github/workflows/deploy.yml` with the same filters — including any
      directory outside `apps/` whose content it serves (`content/**` for
      `apps/web`, ADR-0002/ADR-0015). A filter that misses that directory means
      editing content never republishes.
- [ ] Entry in the root `README.md` repository layout.
- [ ] If it introduces a new language, it brings that language's standards document
      into `docs/standards/` (e.g., `backend-code-style.md` is born with
      `apps/server`, not before) — same rigor as the existing ones: clean code,
      explicit patterns, bounded conventions (ADR-0005).
- [ ] Its **two testing protocols** (per-commit and pre-PR) registered in
      `docs/standards/testing-strategy.md` before its first PR merges.
- [ ] Its extension points registered in `docs/standards/integration-guides.md`.
- [ ] Self-containment honored: manifest, tests, packaging inside the app.

## References

- ADR-0005 — development standards (bounded style, guides, docs-in-flow).
- ADR-0002 — content model (why `content/` is not app code).
- `docs/design/2026-08-redesign.md` — design narrative that produced this layout.
