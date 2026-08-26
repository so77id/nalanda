# Repository Structure

Source of truth for how the Nalanda monorepo is organized: the taxonomy, the
structural principles, where things go, and how to add a new application. Agents
and humans follow this document; deviations are proposed in PRs and recorded here.

## Layout

```
nalanda/
├── apps/                    # deployable applications, each SELF-CONTAINED
│   ├── web/                 # platform frontend (React + TS + Vite)
│   ├── amc-worker/          # control engine: Auto-Multiple-Choice in a container (ADR-0030)
│   └── server/              # backend: Go + SQLite, two delivery surfaces (ADR-0034) — born with #149
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
│   ├── local/               # docker-compose — born with apps/amc-worker (#138)
│   └── deploy/<host>/       # host-specific production images and scripts — born with infra/deploy/jetson/ (#162, ADR-0038)
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
   packaging (Dockerfile lives in the app).

   **For a container app whose dependencies are apt packages, the Dockerfile IS
   the manifest** — there is no second dependency file and adding one is a PR
   discussion, exactly like editing `package.json` (worked case:
   `apps/amc-worker`, whose `python-code-style.md` forbids a `requirements.txt`).
   The rule below still applies to it unchanged: never edit that dependency set
   without discussing first. Someone cloning the repo must be able
   to work on one app reading only that app + the standards.
3. **Fixed taxonomy.**
   - `apps/` — deployables.
   - `packages/` — code shared by two or more apps. Nothing is "promoted" here
     speculatively; a second consumer is the admission ticket.
   - `content/` — course material (Material domain). Not app code: it has its own
     lifecycle (authoring), its own future (database, per ADR-0002), and is
     **written** without entering any `src/` — with one exception, and verifying
     it is another matter again; see below for both.

     **In v0.1 it is also the test suite's fixture set** (ADR-0025), and that is
     a constraint on authoring rather than a note. Several tests assert over the
     live registry because there is no other real content to assert over, so a
     declaration can be forced by a test instead of by the reader. The worked
     case was #108, when `01-bienvenida.mdx` was held at `presentation: auto`
     purely to stay the suite's only `auto` document; #120 turned it into the
     course's opening class (`explicit`) and the auto case was retired rather
     than re-homed, so **no document declares `auto` today**. The constraint
     itself stands: editing `content/` requires the full suite, not only the
     build (`guides/add-a-course-document.md` step 2). ADR-0025 carries the
     alternatives that were rejected and the exit condition.

     **The exceptions to "without entering `src/`"** are three.

     Writing a document's QUESTIONS is one, since #139: a `per-section` document
     declares its deliberately question-less sections in `NO_QUESTION`
     (`apps/web/src/content/architecture.test.ts`), with a reason each, and the
     gate asserts that set exactly — so the suite is red until that file is
     edited.

     The SET of listed documents is the second:
     `app/documentBreadcrumb.test.tsx` asserts that every document in `content/`
     appears in an `index.yaml`, so adding one without listing it turns the suite
     red. Shipping a document deliberately OFF the teaching path therefore means
     editing that assertion — weakening it with an allowlist naming the
     exceptions, the way #136 did and #135 undid.

     The third is the SHAPE of a document the suite uses as a fixture, and since
     #135 that is three of the four: `04-planificacion.mdx` must keep
     `presentation: none` and zero `h2`, and the two Java documents have their
     slide counts and several slide titles pinned.

     Each document constrained this way carries a note under its frontmatter
     saying so (ADR-0025), so the rule an author needs is: **writing prose in a
     document that carries no note needs no `src/` at all** — and if it carries
     one, read it first.

   - `docs/` — knowledge: standards, design, decisions, conventions.
   - `infra/` — running the system around the apps:
     - `infra/local/` — local orchestration (docker-compose, multi-app Makefile)
       and runnable dev mocks of external services.
     - `infra/deploy/` — host provisioning, reverse-proxy/systemd config,
       production compose. Apps package themselves; infra _places_ them.

### One named exception to §2 (added #150)

`apps/server`'s suite reads two files outside the app:
`infra/local/docker-compose.yml` and `.github/workflows/server.yml`
(`internal/infra/config/homes_test.go`). It is deliberate and it is the only one.

The rule it enforces — a configuration variable lives in four homes — spans the
app and the two files that RUN it, so a guard living inside the app is the only
place that can see all four. It was added because the rule drifted inside the PR
that restated it, and it found an older gap on its first run.

The cost, stated so nobody discovers it: a change to either file does not trigger
`server.yml`'s path filters, so this guard fails on a PR that did not touch
`apps/server/` only when something else in that PR did. The compose step of the
pre-PR protocol is still the human's backstop.

## Placement criteria — "where does X go"

| Thing                                                                             | Where                                                                       | Why                                                                                               |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local orchestration (docker-compose / multi-app Makefile)                         | `infra/local/`                                                              | Coordinates apps; belongs to none                                                                 |
| Runnable dev mock of an external service (fake university API, fake OAuth server) | `infra/local/mocks/`                                                        | Exists to run the system locally, not to test                                                     |
| Test fakes/mocks (in-process, used by tests)                                      | Next to the tests, inside their app                                         | Test code                                                                                         |
| A third-party tool we run as a service (AMC, a future OCR engine)                 | `apps/<name>/` — a deployable whose source is a Dockerfile                  | It is a service the system runs, not scaffolding around one. Self-containment applies unchanged (#138) |
| Dockerfile / packaging of one app                                                 | Inside that app                                                             | The app packages itself; infra places it                                                          |
| VPS provisioning, systemd/proxy config, production compose                        | `infra/deploy/`                                                             | Belongs to the host, not to an app                                                                |
| Host-specific production service DEFINITIONS (backup, monitor, prod-only overrides on shared services) | Base compose `infra/local/docker-compose.yml` holds only what dev needs. Prod-only services and prod-only field overrides live in an overlay `infra/deploy/<host>/docker-compose.<host>.yml` that redeclares or overrides fields on shared services and adds host-only sidecars. Overlay is opt-in via `COMPOSE_FILE=docker-compose.yml:../deploy/<host>/docker-compose.<host>.yml` in the host's `.env` — dev never touches it. Images and scripts the sidecars build from live under `infra/deploy/<host>/`. Worked case: `infra/deploy/jetson/docker-compose.jetson.yml` overlays server (image + Watchtower label), adds backup, monitor and amc-worker (#162, #175, ADR-0038 §Decision "Compose-file shape"). Pre-S12 shape (a `profiles: [<host>]` gate inside the base file) was rejected in the same section. |
| One app's integration tests                                                       | In that app                                                                 | They verify ITS behavior                                                                          |
| Cross-app e2e (browser → web → server)                                            | Top-level `e2e/` (created when it first exists)                             | Verifies the whole                                                                                |
| Course assets (images/video)                                                      | `content/`, next to their documents                                         | Material domain                                                                                   |
| Test mocks needed by a second app                                                 | Promote to `packages/`                                                      | Shared-code rule                                                                                  |
| An app's architecture guard (L4 layer invariants)                                 | At the ROOT of the tree it guards, inside the app                           | The invariant is about the relationship BETWEEN directories, so it cannot live inside one of them. Worked cases: `apps/web/src/architecture.test.ts`, `apps/server/internal/architecture_test.go` (#149) |
| Build script (fetches or generates a build input)                                 | `apps/<app>/scripts/`, wired to an npm lifecycle hook (`prebuild`/`predev`) | Neither source nor runtime code; must run before the bundler, and in CI                           |
| Fetched or generated build input (jar, wasm blob)                                 | That app's `public/`, gitignored, digest pinned in the fetching script      | Reproducible without carrying binaries in git — worked case `public/java-compiler.jar` (ADR-0017) |
| Vendored front-end library embedded into a Go binary (JS/CSS/font/WASM the browser downloads) | `apps/<app>/internal/…/static/vendor/<lib>/`, checked into git, one entry PER FILE on an explicit `//go:embed` line (never `all:vendor` — the point is to keep companion files like `.map`, `.sandbox.mjs`, or translation JSON out), with a `README.md` beside them holding four required sections: **Version** (with an "advisories last checked" date because `govulncheck` is Go-only and cannot see it), **Integrity** (SHA-384 per file), **How it is served**, **Upgrading** (recipe that opens with an advisory check against Mozilla / the NVD CPE for the library) | Same "one binary, self-contained" ethos ADR-0034 records for the layered layout and ADR-0038 for the deploy; a CDN would need a CSP allow-list for a foreign origin and the machine grades over a private tailnet where reaching a public CDN is neither guaranteed nor desired. Worked case: `apps/server/internal/app/web/static/vendor/pdfjs/` — PDF.js 6.2.108 for the annotated-PDF viewer on the review page (#231, ADR-0047) |

**Growth rule:** when a new case has no row in this table, propose a placement in
the PR that introduces it and record the outcome here in the same PR. The standard
grows case by case — it is self-governing, like the component catalog.

## How to add a new app

Checklist for any new application under `apps/`. Both `apps/amc-worker` (#138)
and `apps/server` (#149) were admitted through it:

- [ ] Own `README.md` with install / dev / test / build commands — the app is
      understandable alone.
- [ ] Own `CLAUDE.md`: agent rules + pointers to its standards docs (commands
      and stack live in the app README — one home per fact). In the
      same change, edit the **root** `CLAUDE.md` so monorepo-shared concerns stay
      at root and app-specific concerns live in the app — no duplication.
- [ ] Own CI job with **path filters**: changes under `apps/<name>/**` trigger only
      that app's pipeline.
- [ ] If the app deploys, its **own CD workflow** —
      `.github/workflows/<name>-cd.yml`, one per publishable image — rather than
      a matrix row inside a sibling app's workflow. Worked case: `amc-worker-cd.yml`
      was separated from `server-cd.yml` at #175 because texlive under QEMU takes
      ~30 minutes and would sit on every server push. The rule: two apps with
      very different build costs never share a CD workflow. If a third image
      earns its own file, extract the common steps into a reusable workflow
      (`.github/workflows/_docker-build-and-push.yml`) — tracked in #173.
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
- [ ] Registered in `.claude/workflow-bindings.md`: its `CLAUDE.md` under
      *Agent instructions*, its code-style document under *Code style docs*, and
      an `area:` label if it needs one. **Every review lens reads that file
      first**, so an app missing from it is reviewed against another app's
      standards (missed for `apps/amc-worker`, caught in #138's own review).
- [ ] Self-containment honored: manifest, tests, packaging inside the app.

## References

- ADR-0005 — development standards (bounded style, guides, docs-in-flow).
- ADR-0002 — content model (why `content/` is not app code).
- `docs/design/2026-08-redesign.md` — design narrative that produced this layout.
