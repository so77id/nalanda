# Nalanda

Interactive CS learning platform. Browser-first site where theory, slides,
data-structure visualizations, and live code execution coexist.

## Status (August 2026)

**v0.1 "El esqueleto" is complete** — monorepo foundation, content model (MDX
wiki + teaching index), presentation mode, component catalog and static deploy
are all in; the site is live (see [Deployment](#deployment)). Next: v0.2 "El
contenido vivo". Roadmap and design narrative:
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
│   ├── web/            Platform frontend (React 19 + TS + Vite + Tailwind v4)
│   ├── amc-worker/     Control engine: Auto-Multiple-Choice in a container (ADR-0030)
│   └── server/         Backend: Go + SQLite, two delivery surfaces (ADR-0034)
├── content/            Course material (Material domain): courses/<slug>/ — MDX + index.yaml
├── docs/
│   ├── standards/      Dev standards: repo structure, code style, testing, docs
│   ├── design/         Design narratives (2026-08 redesign)
│   ├── decisions/      ADRs, numbered sequentially
│   ├── conventions.md  Workflow conventions (kanban, branches, commits, PRs)
│   ├── security-notes.md  Security deferrals / accepted-risk records
│   └── course-graph.md Course topology (planning tool)
├── infra/
│   └── local/          Local orchestration (docker-compose) — belongs to no single app
├── proof-of-concept/   Archived POC + old roadmap issues (reference)
├── .claude/            Agent infra: workflow bindings, settings (plugins), hooks, repo agents
└── CLAUDE.md           Monorepo-shared agent instructions (per-app CLAUDE.md in each app)
```

Future directories (`packages/`, `e2e/`) are defined in
[`docs/standards/repository-structure.md`](docs/standards/repository-structure.md)
and created when their first real content arrives.

## Development

```bash
cd apps/web
npm install
npm run dev      # localhost:5173
```

The control engine is a container and runs entirely through Docker:

```bash
cd apps/amc-worker
make verify      # build the image, then the full verification suite
```

Its commands, HTTP contract and the AMC traps a caller must not hit:
[`apps/amc-worker/README.md`](apps/amc-worker/README.md). The one verification
no agent can run: [`apps/amc-worker/PAPER-CHECK.md`](apps/amc-worker/PAPER-CHECK.md).

The backend is a Go binary with SQLite underneath. It starts, migrates, answers
`/health`, and lets a professor sign in with Google (ADR-0009, ADR-0036); the
screens they would then use are WP-C3.

```bash
cd apps/server
# Five variables, all required. Placeholders are enough to boot and serve
# /health; a real login needs a real OAuth client — see GOOGLE-CHECK.md.
NALANDA_ADDR=127.0.0.1:8081 \
NALANDA_DATABASE_URL=./nalanda.db \
NALANDA_PUBLIC_URL=http://127.0.0.1:8081 \
NALANDA_GOOGLE_CLIENT_ID=placeholder.apps.googleusercontent.com \
NALANDA_GOOGLE_CLIENT_SECRET=placeholder-secret \
  go run ./cmd/server

# or through Docker, which is also how the two services meet:
cd infra/local && docker compose up -d --wait server
```

Its configuration contract, the two delivery surfaces and what is deliberately
not there yet: [`apps/server/README.md`](apps/server/README.md) and
[`apps/server/CLAUDE.md`](apps/server/CLAUDE.md). The login has a verification no
test can perform either — no suite reaches Google:
[`apps/server/GOOGLE-CHECK.md`](apps/server/GOOGLE-CHECK.md).

Full command list and app-specific rules: [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md)
and [`apps/web/README.md`](apps/web/README.md). Before contributing, read
[`docs/standards/`](docs/standards/) — especially the two testing protocols
(per-commit and pre-PR) in `testing-strategy.md`.

## Deployment

The site is live at **<https://so77id.github.io/nalanda/>** (GitHub Pages, free
project-pages URL). A custom domain would change the Vite `base` and the
`/nalanda/` assertions in `apps/web/src/app/deployedApp.test.tsx` — runtime code
derives everything else from `BASE_URL` — but deep links already shared under the
prefix may not survive the move, so decide before handing URLs to students
(ADR-0015).

- **What publishes it**: `.github/workflows/deploy.yml`, on every push to `main`
  that touches `apps/web/**`, `content/**` or the workflow itself. Course
  material lives outside `apps/` (ADR-0002), so writing a class republishes the
  site; a commit touching only `docs/**` or this README does not (app-local docs
  under `apps/web/**` do trigger a republish — harmless, just a wasted build). It
  can also be run by hand from the Actions tab (`workflow_dispatch`) without
  committing anything.
- **How deep links survive**: Pages is a static file server, so
  `/nalanda/d/bienvenida` has no file behind it. The build copies `index.html`
  to `404.html` (`apps/web/src/app/spaFallback.ts`), which Pages serves for
  unknown paths, handing the URL to the router.
- **How to verify after a deploy**: open `/nalanda/`, one deep document link
  (e.g. `/nalanda/d/java-desde-cpp`), `/nalanda/catalog`, and — since #74 —
  **run one snippet** on `/nalanda/d/java-tipos-y-flujo`. A green workflow no
  longer proves the site works: the code runtimes come from third-party CDNs
  that can fail without any deploy of ours. Locally,
  `npm run build && npm run preview` serves the real build under `/nalanda/` and
  proves the base path and the router basename — but NOT the fallback, because
  `vite preview` has its own SPA fallback that masks a missing `404.html`. That
  mechanism is guarded by tests instead (`apps/web/src/app/spaFallback.test.ts`).
- **What gets published**: every `.mdx` under `content/courses/**` — the index
  only controls navigation — and, since #139, `questions.json` at the site root:
  the control question bank, including which alternatives are correct. Public on
  purpose, so never author a question whose answer must stay private (see
  `docs/security-notes.md`).
- **Not everything a reader sees is published by us.** Since #146,
  `/nalanda/d/planificacion` frames a Google spreadsheet: the calendar is not in
  this repository, it changes with **no commit and no deploy**, and nothing in
  the build or the suite can see what it says (ADR-0035). Add it to the
  after-deploy check and look at the rectangle — a sheet that stops being shared
  shows Google's own request-access page there, and nothing anywhere will tell
  you.
- **Rollback**: revert the offending commit on `main`. The revert is itself a
  push to `main`, so it redeploys the previous version — there is no separate
  deploy button to press. **It does not restore the calendar**: reverting can
  remove the frame, never change what the sheet says. That is Google Drive's
  version history, not git's.
- **When something is broken**, work back from the symptom:

  | Symptom | Cause | Guarded by |
  |---|---|---|
  | Blank page, `/assets/*` 404 | wrong `base` in `vite.config.ts` | `deployedApp.test.tsx` |
  | Deep link 404s live but works in dev | missing `404.html` | `spaFallback.test.ts` |
  | Deep link renders "Page not found" | router basename | `basename.test.ts`, `deployedApp.test.tsx` |
  | Workflow green, site unchanged | path filters did not match — rerun from the Actions tab | — |
  | Deploy job fails on permissions | repo Settings ▸ Pages source must be "GitHub Actions", and the `github-pages` environment must allow `main` | — |
  | Deploy job fails before Vite starts | `prebuild` could not reach Maven Central, or the ECJ checksum did not match | the script's own error; nothing is written on mismatch (ADR-0017) |
  | Site fine, but Ejecutar never finishes or never warms | a runtime CDN is down or blocked (`cjrtnc.leaningtech.com`, `cdn.jsdelivr.net`) | nothing — accepted risk, `docs/security-notes.md` |
  | `/d/planificacion` shows "Cargando la planilla…" and never the grid, or shows Google's request-access page | the sheet stopped being shared, or Drive is unreachable | nothing — cross-origin, undetectable; fix the share setting in Drive, `docs/security-notes.md` |
  | The calendar is wrong and reverting the commit does not fix it | the sheet is not in this repo (ADR-0035) — edit the spreadsheet | nothing, by design: that decoupling is the feature |
  | `/d/<id>/present` blank on an old iPhone | `MediaQueryList.addEventListener` needs Safari/iOS 14 | nothing — accepted baseline, ADR-0023 |
  | `/d/<id>/present` shows "Gira el teléfono" and no slide | working as designed on a touch device held upright; rotate, or use the book view | `presentationRoute.test.tsx`, ADR-0023 |
  | Slide text renders small, or slide sizes vary across a deck | working as designed — each slide is scaled to fit its stage (ADR-0013 §5.1). If it is unreadable the slide is too dense: split it | `presentation/fit.test.ts` |

## Workflow

All changes go through PRs (squash-merged manually). See
[`docs/conventions.md`](docs/conventions.md) for branch naming, commit format,
kanban columns, and the WP lifecycle.
