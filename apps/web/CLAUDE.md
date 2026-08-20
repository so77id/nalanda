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
- `docs/standards/design-system.md` — the colour tokens, the legal pairings and the rules for using them. **Read before writing any UI.** A raw Tailwind colour class fails `src/architecture.test.ts`: it is correct in at most one of the two themes, and no jsdom test can see which (#109, ADR-0026).
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
- **The suite cannot execute code, lay out a page, move focus, or load another
  origin like a browser.** Three classes, all needing a real browser, all spelled
  out in `docs/standards/testing-strategy.md` §Conventions with their worked
  cases:
  1. _Execution_: every runtime is faked in jsdom, so anything that **DRIVES a
     runtime** needs a browser too — any change under `src/runtime/**`, anything
     that calls `run()` through `useRuntime`/`useLoadedRuntime`, anything that
     GENERATES a compilation unit sent to one (`harness.ts`), and anything that
     mounts `CodeEditor`. Today that is `CodeEditor`, `Exercise`,
     `PredictOutput`, the draft store, and since #85 `MdxPre` and any fence in
     `content/` tagged with a runtime id.

     Stated as a class and not a list on purpose, and **the class itself has
     gone stale three times**: once when `Exercise` arrived, again when a
     markdown fence became a component, a third time when it was worded as
     "mounts `CodeEditor`" — which the memory-diagram widget retired in #209
     deliberately did NOT do while driving a real JVM end to end — and a fourth
     when #209 retired that widget outright (moving memory drawings off the
     runtime, so the class shrank). Narrow the class to what the code DOES,
     never to what it imports.

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

     When the paint itself cannot be pure — a theme-keyed per-argument colour —
     surface the INPUT the paint is derived from as a semantic `data-*`
     attribute and pin THAT instead of the paint. Worked case:
     `components/interactive/RecursionTree.tsx` exposes `data-arg` on every
     node, and `RecursionTree.test.tsx` asserts that two duplicated arguments
     carry the same `data-arg` — a stand-in for "same hue" jsdom is not asked
     to observe. The browser check confirms the actual paint against the live
     tokens in both themes. The recipe lives in `testing-strategy.md`
     §Conventions ("A property jsdom cannot see").

     One further step is Mermaid's: the component hands its source to a
     third-party SVG layout engine jsdom cannot run at all — the library
     refuses to render against it — so `<Mermaid>` (ADR-0040) pins the
     container attributes, the source handed to the library and the
     authoring-error branch, and the painted SVG is confirmed in a real
     browser in both themes. The lazy boundary itself is pinned by the
     suite — the per-name case and the eager-graph walk in
     `src/architecture.test.ts` fail if mermaid leaves its lazy wrapper —
     and S9 confirmed it once in a real browser: a page without a diagram
     requests zero mermaid chunks, and the mermaid chunks are the only NEW
     payload a diagram page downloads (part of the library rides in a chunk
     already shared with the first paint, ADR-0040 §Consequences).

     A device rule also needs an emulated device, not
     merely a small window: the recipe is in `testing-strategy.md` §Conventions.

  3. _A document from somewhere else_: jsdom has no network and never loads a
     frame, so a component that **EMBEDS ANOTHER ORIGIN** is unverifiable here in
     the only way that counts. The suite can pin the attribute string and
     nothing about its effect — whether the document renders at all, what a
     `sandbox` token actually permits, what the frame weighs, whether the
     reader's gesture even reaches our handlers. All three of those were
     answered only in Chromium in #146: `sandbox="allow-popups"` without
     `allow-popups-to-escape-sandbox` opened a link and then broke the page it
     opened; `loading="lazy"` on an iframe defers nothing until roughly 4000px
     below the fold, so it bought nothing on either shipping page; and one frame
     costs ~570kB of third-party payload, three times the whole app. Anything
     rendering an `<iframe>` is checked in a real browser against the built site:
     the frame paints, each permission re-measured whenever the string changes,
     weight from a cold profile, and a sideways drag on a touch context. Worked
     case: `<SheetEmbed>` (ADR-0035).

  Written as classes rather than lists of names because the list was already
  stale once: `Exercise` arrived with the same shape and the same hazard, and
  the rule still said `CodeEditor`. The class was _also_ stale as a set — it
  named execution alone until #84 shipped two layout/focus bugs past a green
  suite, and named only those two until #146 embedded a third party. State a new
  class by what the code DOES — loads another origin — never by the tag it
  happens to use.

- Java deliberately does NOT run in a Web Worker (ADR-0017), and a Java infinite
  loop freezes the tab with no recovery — relevant whenever you author or verify
  course content with runnable Java.
