# @nalanda/web

The Nalanda platform frontend: course wiki (book mode), presentation mode, and
the content-component catalog. React 19 + TypeScript (strict) + Vite + Tailwind
CSS v4 (+ typography plugin) + framer-motion; course documents compile from MDX
(ADR-0003) via `@mdx-js/rollup` + a **remark and a rehype** plugin list, sourced from the
repo-root `content/` tree (ADR-0002, ADR-0012, ADR-0027). Mathematics renders at build
time through remark-math + rehype-katex, so no KaTeX JavaScript ships.

Since #74 it also **executes code in the reader's browser**: CodeMirror 6 editors
(+ lucide-react icons) driving three runtimes — Java on CheerpJ, C++ on
browsercc, Python on Pyodide (ADR-0018).

## Commands

```bash
npm install          # dependencies
npm run dev          # Vite dev server → http://localhost:5173  (runs predev first)
npm run build        # tsc -b (type gate) + vite build → dist/    (runs prebuild first)
npm run preview      # serve the production build locally, under /nalanda/
npm run lint         # oxlint
npm run format       # prettier --write
npm run format:check # prettier --check
npm run test         # vitest run (full suite)
npm run test:watch   # vitest watch mode
```

`predev`/`prebuild` run `scripts/fetch-java-compiler.mjs`, which downloads ECJ
3.21 (~2.9MB) from Maven Central into `public/java-compiler.jar` — a gitignored
build input, verified against a SHA-256 pinned in the script and reused on later
runs. **The first build of a clean checkout needs network access**; offline it
fails before Vite starts, and on a checksum mismatch nothing is written
(ADR-0017).

## Source layout

See `docs/standards/frontend-code-style.md` for the authoritative rules — it
owns _which folders may exist and why_. The tree below is the narrower fact this
README is the home for: what is in each of them **today**, plus the app-specific
files the standard does not carry.

```
src/
├── app/                  # shell: entry, router (documents, presentation, catalog, 404),
│                         # MDX map, per-route document title, deployed base/basename,
│                         # SPA-fallback build plugin
├── catalog/              # /catalog surface: registry, family taxonomy, component +
│                         # governance pages, live-example blocks
├── components/           # catalog content components by family (structure: Slide,
│                         # SectionBreak, SideBySide; interactive: CodeEditor, Exercise,
│                         # MemoryDiagram (+ MemoryPlayer/MemoryState, and trace.ts +
│                         # memoryLayout.ts as its JVM-free halves)
│                         # + their lazy wrappers, shared Panel/useRunShortcut/
│                         # useLoadedRuntime/draft/placeholder)
│                         # + their colocated <Component>.catalog.tsx entries,
│                         # + AuthoringError: shared across families, not a content component
│                         # + MdxPre: the pre→component seam (registered in the SHELL's
│                         #   map, not a catalog component), embedded.ts: the context by
│                         #   which a framing container tells its children so
├── content/              # content pipeline: MDX registry, course index, the two plugin
│                         # lists (remark: wiki-links, fence metadata, GFM, math;
│                         # rehype: KaTeX), element renderers
│                         # (links, tables), build-time integrity gate
│                         # + the reading shell: book-mode page, course-index tree
│                         #   (collapsed to the active path, filterable), breadcrumb,
│                         #   section spine hook and its two placements: the rail
│                         #   at 2xl, the drawer at every width below it
├── presentation/         # presentation mode: mode context, slide parser, SlideDeck viewer,
│                         # the phone-orientation rule (ADR-0023), the swipe gesture
│                         # and the fit-to-stage scaler (ADR-0013 §5.1/§5.2)
├── runtime/              # code execution: worker contract, registry, useRuntime hook,
│                         # one folder per language (java, cpp, python)
├── lib/                  # pure TS utilities + cross-feature contract types
│                         # (catalogEntry, componentMeta, reactText, codeFences, runtimeIds)
├── styles/               # Tailwind entry + design tokens
├── mdx.d.ts              # module typing for *.mdx imports
└── architecture.test.ts  # import-direction invariants
```

All feature folders now exist. The guides are indexed in
`docs/standards/integration-guides.md` — listed here too they drifted, three of
six, stale since the amc-worker and control-question guides landed.

## Deployed shape

The site is published under **`/nalanda/`** (GitHub Pages project URL; the
repo-level story — trigger, rollback — is in the root README).

**Browser baseline: Safari 15.4+ / iOS 15.4+** — raised from 14 by `dvh`
(#99); `MediaQueryList.addEventListener` (Safari 14) was the previous floor.
The two fail differently and the difference matters when a student reports
something: below 14 the `/present` route throws and the page is blank, while
below 15.4 `dvh` is simply ignored, so the deck silently draws under the mobile
browser's chrome again, with no error and no test to catch it. Also assumed:
`ResizeObserver` (Safari 13.1), below both floors. Any browser that can run the
in-browser runtimes clears all of this by a wide margin — a much heavier bar,
and in practice any browser that can run the in-browser runtimes — a much
heavier bar, imposed by ADR-0016/0017 but never written as a version. No legacy
fallbacks are shipped; the decision and the case that does not hold are in
ADR-0023.

- `vite.config.ts` owns the base path: `/nalanda/` for `build` and `preview`,
  `/` for `dev` so local URLs stay short. Runtime code never hardcodes it —
  `App.tsx` derives the router basename from `import.meta.env.BASE_URL`.
- `src/app/spaFallback.ts` copies `index.html` to `404.html` at build time.
  Pages serves that file for paths with no file behind them, which is what makes
  `/nalanda/d/<id>` load instead of 404ing.
- Gotcha: `vite preview` has its own SPA fallback, so it cannot prove the
  `404.html` exists — `src/app/spaFallback.test.ts` and the build-shape cases in
  `src/app/deployedApp.test.tsx` are what actually guard both mechanisms.
- `dist/` also ships **`questions.json`**, emitted by the
  `nalanda:question-bank` plugin at `generateBundle`: every document
  `index.yaml` lists, in reading order, with its section slugs in document
  order, and every control question with its statement, its listing and the
  index SET of its correct alternatives. Served at `/nalanda/questions.json`,
  and the future `apps/server` reads it from there rather than from a checkout
  (design C14) — so the name and the shape are a cross-app contract, not an
  internal detail. **It carries the answers on purpose**
  (`docs/security-notes.md`). Documents off the teaching path are skipped: a
  control covers a range of the reading order, so their questions could never be
  drawn. A duplicate question id fails the BUILD, because it is the join key
  into a grade.
- `dist/` also ships **`java-compiler.jar`** (2.9MB), fetched at build time and
  read back by CheerpJ through the deployed base path — `/app/nalanda/…` in
  production, `/app/…` in dev, derived from `BASE_URL` like everything else
  (`src/runtime/java/classPath.ts`).
- `dist/` also ships **KaTeX's 60 font files** (1072.9 kB; woff2 + woff + ttf, of which
  only woff2 is ever requested by a browser able to run this app — accepted, Pages storage
  is free, ADR-0027 §4). They come from our own origin and are fetched only when a page
  actually renders a glyph: ~42 kB of woff2 for a typical formula, and **nothing at all**
  for a page without mathematics. `build.assetsInlineLimit: 0` is what keeps that true —
  at Vite's default one face was small enough to be inlined into the global stylesheet,
  which made every page in the site pay for it (ADR-0027 §3).
- **Bumping KaTeX**: `rehype-katex` resolves its **own** copy (`^0.16.0`), so raising the
  `katex` line in `package.json` alone ships a stylesheet that does not match the markup
  it styles. #118 did exactly that: 0.18's CSS over 0.16's class names, which looked
  almost right — `.strut` computed `display: inline` instead of `inline-block`. After any
  bump, check `npm ls katex` shows a single deduped version and look at a formula in a
  browser (ADR-0027 §7).
- The rest of the execution machinery is **not** ours to serve: Pyodide and
  browsercc come from `cdn.jsdelivr.net`, CheerpJ from `cjrtnc.leaningtech.com`
  (ADR-0018 §5). Nothing is fetched until an editor asks for a runtime — the
  first Ejecutar, or page load for a `warmOnMount` editor (the `lab` variant),
  so a page carrying one pays the CDN cost on open. A **fence** in one of those
  languages is the editor (#85), so any document with one pulls the CodeMirror
  chunks — lazily, never in the entry chunk, and still no runtime: the price is
  in ADR-0018 §Consequences. There is no offline use, and
  a CDN outage breaks the Run button with no deploy of ours — accepted risk with
  review triggers in `docs/security-notes.md`.

## Testing

Two mandatory protocols (per-commit and pre-PR) are defined in
`docs/standards/testing-strategy.md`. Tests are colocated (`Thing.test.tsx`
beside `Thing.tsx`) and run with Vitest + Testing Library.
