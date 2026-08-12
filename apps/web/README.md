# @nalanda/web

The Nalanda platform frontend: course wiki (book mode), presentation mode, and
the content-component catalog. React 19 + TypeScript (strict) + Vite + Tailwind
CSS v4 (+ typography plugin) + framer-motion; course documents compile from MDX
(ADR-0003) via `@mdx-js/rollup` + remark plugins, sourced from the repo-root
`content/` tree (ADR-0002, ADR-0012).

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

See `docs/standards/frontend-code-style.md` for the authoritative rules.

```
src/
├── app/                  # shell: entry, router (documents, presentation, catalog, 404),
│                         # MDX map, deployed base/basename, SPA-fallback build plugin
├── catalog/              # /catalog surface: registry, family taxonomy, component +
│                         # governance pages, live-example blocks
├── components/           # catalog content components by family (structure: Slide,
│                         # SectionBreak; interactive: CodeEditor + its lazy wrapper)
│                         # + their colocated <Component>.catalog.tsx entries
├── content/              # content pipeline: MDX registry, course index, wiki-links,
│                         # book-mode page, build-time integrity gate
├── presentation/         # presentation mode: mode context, slide parser, SlideDeck viewer
├── runtime/              # code execution: worker contract, registry, useRuntime hook,
│                         # one folder per language (java, cpp, python)
├── lib/                  # pure TS utilities + cross-feature contract types
│                         # (catalogEntry, componentMeta, reactText)
├── styles/               # Tailwind entry + design tokens
├── mdx.d.ts              # module typing for *.mdx imports
└── architecture.test.ts  # import-direction invariants
```

All feature folders now exist. Guides: authoring course material (frontmatter,
wiki-links, slide markers) → `docs/standards/guides/add-a-course-document.md`;
adding a content component → `docs/standards/guides/add-a-content-component.md`
(its rules are rendered at `/catalog/governance`); adding a language runtime →
`docs/standards/guides/add-a-language-runtime.md`.

## Deployed shape

The site is published under **`/nalanda/`** (GitHub Pages project URL; the
repo-level story — trigger, rollback — is in the root README).

- `vite.config.ts` owns the base path: `/nalanda/` for `build` and `preview`,
  `/` for `dev` so local URLs stay short. Runtime code never hardcodes it —
  `App.tsx` derives the router basename from `import.meta.env.BASE_URL`.
- `src/app/spaFallback.ts` copies `index.html` to `404.html` at build time.
  Pages serves that file for paths with no file behind them, which is what makes
  `/nalanda/d/<id>` load instead of 404ing.
- Gotcha: `vite preview` has its own SPA fallback, so it cannot prove the
  `404.html` exists — `src/app/spaFallback.test.ts` and the build-shape cases in
  `src/app/deployedApp.test.tsx` are what actually guard both mechanisms.
- `dist/` also ships **`java-compiler.jar`** (2.9MB), fetched at build time and
  read back by CheerpJ through the deployed base path — `/app/nalanda/…` in
  production, `/app/…` in dev, derived from `BASE_URL` like everything else
  (`src/runtime/java/classPath.ts`).
- The rest of the execution machinery is **not** ours to serve: Pyodide and
  browsercc come from `cdn.jsdelivr.net`, CheerpJ from `cjrtnc.leaningtech.com`
  (ADR-0018 §5). Nothing is fetched until a student presses Ejecutar, but there
  is no offline use, and a CDN outage breaks the Run button with no deploy —
  accepted risk with review triggers in `docs/security-notes.md`.

## Testing

Two mandatory protocols (per-commit and pre-PR) are defined in
`docs/standards/testing-strategy.md`. Tests are colocated (`Thing.test.tsx`
beside `Thing.tsx`) and run with Vitest + Testing Library.
