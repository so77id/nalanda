# ADR-0015: Static publishing pipeline — URL shape, SPA fallback, self-verifying deploy

**Status:** Accepted
**Date:** 2026-08-11
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #66 (WP5, deploy to GitHub Pages — the last v0.1 work package).
Extends ADR-0004 and D14, which chose "fully static site on GitHub Pages" as the
platform but fixed nothing about how it is published.

## Context

v0.1 ends with the app publicly reachable. Publishing a client-side router on a
plain file server forces three decisions the platform choice does not answer:
what URL the site lives at, how deep links survive a host that only serves
files, and what gates the publish.

## Decision

1. **Project-Pages URL**: `https://so77id.github.io/nalanda/`. Free, zero
   configuration, and it unblocks v0.1 today. Consequence: every deployed URL
   carries the `/nalanda/` prefix.

2. **A custom domain is deferred, not rejected** (discussed with Miguel,
   2026-08-10). Moving later costs a DNS record, the `base` value, and the
   `/nalanda/` assertions in `deployedApp.test.tsx` — but **deep links already
   shared under the prefix may not survive the move**. Review trigger: before
   handing deep links to a cohort of students. A university subdomain is the
   likeliest form.

3. **The base path is owned by `vite.config.ts`**, for `build` and `preview`
   alike, and `/` for `dev` so local URLs stay short. Runtime code never
   hardcodes it: the router derives its basename from `import.meta.env.BASE_URL`
   (`app/basename.ts`). CI passes no `--base` flag — a CI-only flag makes local
   builds unreproducible, and the first version of this WP proved the hazard in
   the other direction: keying the base on `command === 'build'` alone silently
   broke `vite preview`, which resolves as `serve`.

4. **Deep links survive via a build-emitted `404.html`** — a copy of
   `index.html` written by the `spaFallback` Vite plugin. Pages serves that file
   for paths with no file behind them, so the router receives the URL.
   Implemented as a plugin rather than a `cp` in the build script: identical on
   every OS and in CI, and it honors `outDir`.

5. **The publishing path verifies itself**: the publish workflow's `build` job
   runs lint and tests before building (the `deploy` job only uploads). CI runs in parallel on the same push and nothing consumes
   its result, so gating on a sibling job would be gating on nothing.
   Permissions are least-privilege — the build job (which runs third-party
   install scripts) is read-only; `pages: write` and `id-token: write` live on
   the deploy job. Actions are pinned by commit SHA, which holds for direct
   references only: composite actions resolve their own dependencies by tag.

6. **Publication is glob-driven**: every `.mdx` under `content/courses/` is
   compiled and served at `/d/<id>`. `index.yaml` controls navigation, never
   visibility — there is no unpublish mechanism. Recorded as an accepted
   invariant with its review trigger in `docs/security-notes.md`.

## Alternatives considered

- **Custom domain now**: no prefix, no future migration of shared links; costs a
  domain and a decision Miguel does not need to make to finish v0.1. Deferred
  (Decision 2), not rejected.
- **HashRouter** (`/#/d/bienvenida`): no 404.html needed and works on any host,
  but ugly URLs, broken fragment anchors (the catalog and heading anchors both
  use them), and a URL shape that cannot later become clean without breaking
  every shared link. Rejected.
- **A server or meta-framework with rewrite rules**: the correct answer for a
  dynamic site and the wrong one here — ADR-0001 (client-side compute) and
  ADR-0004 (static) both push the other way, and it would add hosting cost.
- **`--base` flag in the workflow** (what the POC's workflow did): keeps the
  config generic, but the local build then differs from the deployed one.
  Rejected in favour of Decision 3.
- **Gating deploy on CI via `workflow_run`**: composes the gates instead of
  duplicating them, at the cost of a second workflow hop and a trigger shape
  that is easy to get wrong. Rejected for now; the duplication is ~40 seconds.

## Consequences

- The `/nalanda/` prefix is a standing constraint: assets, links and any future
  absolute path must derive from `BASE_URL`.
- `404.html` is generated, never hand-edited. `vite preview` cannot prove it
  exists (it has its own SPA fallback), so `spaFallback.test.ts` and the
  build-shape cases in `deployedApp.test.tsx` are what guard the mechanism.
- Every legitimate deep link is served with an HTTP 404 status. Harmless for
  browsers; relevant if analytics or crawlers are ever added.
- Lint and tests run twice per push to `main` (CI and the deploy job).
- Merging to `main` publishes. With no branch protection (deferred, recorded in
  `docs/security-notes.md`), a direct push to `main` also publishes. The gate is
  partial: a commit that fails lint, the tests or the build never reaches the
  deploy job, but **runtime breakage the suite cannot see still publishes** —
  there is no browser smoke yet (testing-strategy L5 remains pending), which is
  exactly how the blank-page regression inside this WP survived until a human
  looked at the page.
