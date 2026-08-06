# ADR-0011: Frontend dev toolchain and routing library

**Status:** Accepted
**Date:** 2026-08-06
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #62 refinement (dated agreements 2026-08-06) + PR #67 review pipeline (Round B, ADR-hunter lens)

## Context

ADR-0004 fixed the frontend stack (React, TypeScript, Vite, Tailwind,
framer-motion) but named no lint/test tooling and no routing library. WP1
(issue #62) had to choose both, and the choices constrain what "bounded style
enforcement" (ADR-0005) and the testing protocols can ever mean. They belong in
the decision record, not only in standards prose.

## Decision

- **Linter: oxlint** (Rust-based, ships with the current Vite react-ts
  template), replacing the POC's ESLint. Covers correctness + React/hooks rules
  (`.oxlintrc.json` carries `react/rules-of-hooks: error`); the type gate is
  `tsc -b` inside `npm run build`. Formatting: **Prettier** (industry default,
  no real alternative considered).
- **Unit/component test runner: Vitest + Testing Library** (jsdom), colocated
  tests, also hosting the architecture tests (L4).
- **Browser smoke (L5): Playwright**, replacing the POC's hand-rolled
  puppeteer-core scripts. Introduced with the first real smoke (WP2+).
- **Routing: react-router-dom**, in plain static-SPA mode (BrowserRouter). This
  extends ADR-0004's stack enumeration. No SSR/RSC will enter this frontend —
  a premise already established by ADR-0001 (client-side compute) and ADR-0004
  (no meta-framework; Next.js rejected for adding a rendering server). That
  premise underwrites the GHSA-qwww-vcr4-c8h2 deferral recorded in
  `docs/security-notes.md`.

## Alternatives considered

- **ESLint 9** (the POC's linter, originally listed in issue #62): mature plugin
  ecosystem and type-aware rules, but 50–100× slower and heavier config; oxlint
  covers the rules this codebase needs today, and `tsc -b` guards types.
  Trade-off accepted: no type-aware lint rules, thin plugin ecosystem — revisit
  if a needed rule class has no oxlint support.
- **Jest**: second-class Vite/ESM citizen; Vitest shares the Vite pipeline.
- **puppeteer-core scripts** (POC model): proven here, but hand-rolled waiting/
  reporting; Playwright brings auto-waiting, traces, and first-class CI.
- **TanStack Router / wouter**: capable, but react-router is the default the
  team and ecosystem know; static-SPA usage keeps the surface minimal.

## Consequences

- `frontend-code-style.md` and `testing-strategy.md` reference this ADR as the
  decision home; they keep the *how*, this file keeps the *why*.
- The react-router advisory deferral has an architectural backstop (no server
  runtime) documented here and in ADR-0001/0004.
- Tooling swaps (e.g., oxlint → ESLint if type-aware rules become necessary)
  supersede this ADR explicitly.
