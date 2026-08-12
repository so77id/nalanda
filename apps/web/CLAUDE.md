# CLAUDE.md — apps/web

The Nalanda platform frontend. Read the root `CLAUDE.md` first for monorepo-shared
rules; this file covers what is specific to this app.

## Commands & stack

Single home: [`README.md`](./README.md) — read it before working here for the
command list, the stack summary, and the **deployed shape** (base path
`/nalanda/`, router basename from `import.meta.env.BASE_URL`, the `404.html`
SPA fallback and the `vite preview` gotcha). One home per fact, per
`docs/standards/documentation.md`.

## Mandatory reading

- `docs/standards/frontend-code-style.md` — the authoritative `src/` folder layout, naming, component rules and import direction (`app → features → lib`, plus the cross-feature edge allowlist). **Follow, don't innovate.**
- `docs/standards/testing-strategy.md` — the `apps/web` per-commit and pre-PR protocols. Nothing is committed in red.
- `docs/standards/integration-guides.md` — index of the extension-point guides; read the matching guide before adding a component, a document, or an app.

## App-specific rules

- Do not modify `vite.config.ts`, `tsconfig*.json`, `.prettierrc.json`,
  `.oxlintrc.json`, or `vitest.setup.ts` without user confirmation (dependency
  changes are governed by the root rule).
- **Fix lints rather than disabling rules** — never silence or downgrade a lint
  rule to go green without user confirmation.
- Logging: `console.log/info/warn/error` only while debugging — never left in
  committed code; never log secrets or personal data.
- Tests are colocated (`Thing.test.tsx` beside `Thing.tsx`); component tests
  assert contract/behavior, not implementation details.
- `npm run dev` and `npm run build` run `scripts/fetch-java-compiler.mjs` first
  (`predev`/`prebuild`): it downloads ~2.9MB from Maven Central on a clean
  checkout, so **an offline first build fails before Vite starts**.
- **The suite cannot execute code.** Every runtime is faked in jsdom, so any
  change under `src/runtime/**`, or to a component that drives a runtime
  (`CodeEditor`, `Exercise`, `harness.ts`) or the draft store, needs a real
  browser too — recipe in `docs/standards/guides/add-a-language-runtime.md` §7.
  Written as a class rather than a list of names because the list was already
  stale once: `Exercise` arrived with the same shape and the same hazard, and the
  rule still said `CodeEditor`.
- Java deliberately does NOT run in a Web Worker (ADR-0017), and a Java infinite
  loop freezes the tab with no recovery — relevant whenever you author or verify
  course content with runnable Java.
