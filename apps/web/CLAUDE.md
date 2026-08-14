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
- **The suite cannot execute code, lay out a page, or move focus like a
  browser.** Two classes, both needing a real browser, both spelled out in
  `docs/standards/testing-strategy.md` §Conventions with their worked cases:
  1. _Execution_: every runtime is faked in jsdom, so anything that **DRIVES a
     runtime** needs a browser too — any change under `src/runtime/**`, anything
     that calls `run()` through `useRuntime`/`useLoadedRuntime`, anything that
     GENERATES a compilation unit sent to one (`harness.ts`, `trace.ts`), and
     anything that mounts `CodeEditor`. Today that is `CodeEditor`, `Exercise`,
     `MemoryDiagram`, the draft store, and since #85 `MdxPre` and any fence in
     `content/` tagged with a runtime id.

     Stated as a class and not a list on purpose, and **the class itself has now
     gone stale twice**: once when `Exercise` arrived, again when a markdown
     fence became a component, and a third time when it was worded as "mounts
     `CodeEditor`" — which `MemoryDiagram` deliberately does not do (ADR-0026
     draws its own listing) while driving a real JVM end to end. If you are
     tempted to narrow it again, narrow it to what the code DOES, never to what
     it imports.

  2. _Layout, focus and device shape_: jsdom lays nothing out and does not
     implement the browser's tab order, so anything that enumerates focusables,
     moves focus, depends on a viewport width, a scroll position, a device
     capability asked through `window.matchMedia` (pointer type, orientation —
     jsdom implements no media query at all), measured element geometry or
     computed style (every box is 0×0 and `getComputedStyle` only echoes inline
     styles, so a test must FAKE both — and then the failure is not an inert
     test but a GREEN one pinning whatever the author assumed: #103 shipped a
     predicate whose fakes had pinned a false positive as the contract), a
     touch gesture (jsdom fires the events but lays out and scrolls nothing),
     or a rule in `styles/index.css` needs a browser too. A guard whose
     predicate is a DOM measurement is verified in a browser against the
     property it claims to measure — the recipe is in `testing-strategy.md`
     §Conventions.

     **The way out is to not measure.** Geometry a component _computes_ — a
     layout, a scale — belongs in a pure module the suite can check exactly,
     leaving the browser to confirm only that it looks right. Worked case:
     `components/interactive/memoryLayout.ts` with `memoryLayout.test.ts`, which
     asserts that frames do not overlap and that the canvas holds what it drew,
     without faking a single measurement.

     A device rule also needs an emulated device, not
     merely a small window: the recipe is in `testing-strategy.md` §Conventions.

  Written as classes rather than lists of names because the list was already
  stale once: `Exercise` arrived with the same shape and the same hazard, and
  the rule still said `CodeEditor`. The class was _also_ stale as a set — it
  named execution alone until #84 shipped two layout/focus bugs past a green
  suite.

- Java deliberately does NOT run in a Web Worker (ADR-0017), and a Java infinite
  loop freezes the tab with no recovery — relevant whenever you author or verify
  course content with runnable Java.
