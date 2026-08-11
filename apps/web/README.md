# @nalanda/web

The Nalanda platform frontend: course wiki (book mode), presentation mode, and
the content-component catalog. React 19 + TypeScript (strict) + Vite + Tailwind
CSS v4 (+ typography plugin) + framer-motion; course documents compile from MDX
(ADR-0003) via `@mdx-js/rollup` + remark plugins, sourced from the repo-root
`content/` tree (ADR-0002, ADR-0012).

## Commands

```bash
npm install          # dependencies
npm run dev          # Vite dev server → http://localhost:5173
npm run build        # tsc -b (type gate) + vite build → dist/
npm run preview      # serve the production build locally, under /nalanda/
npm run lint         # oxlint
npm run format       # prettier --write
npm run format:check # prettier --check
npm run test         # vitest run (full suite)
npm run test:watch   # vitest watch mode
```

## Source layout

See `docs/standards/frontend-code-style.md` for the authoritative rules.

```
src/
├── app/                  # shell: entry, router (documents, presentation, catalog, 404),
│                         # MDX map, deployed base/basename, SPA-fallback build plugin
├── catalog/              # /catalog surface: registry, family taxonomy, component +
│                         # governance pages, live-example blocks
├── components/           # catalog content components by family (structure: Slide,
│                         # SectionBreak) + their colocated <Component>.catalog.tsx entries
├── content/              # content pipeline: MDX registry, course index, wiki-links,
│                         # book-mode page, build-time integrity gate
├── presentation/         # presentation mode: mode context, slide parser, SlideDeck viewer
├── lib/                  # pure TS utilities + cross-feature contract types
│                         # (catalogEntry, componentMeta, reactText)
├── styles/               # Tailwind entry + design tokens
├── mdx.d.ts              # module typing for *.mdx imports
└── architecture.test.ts  # import-direction invariants
```

All feature folders now exist. Guides: authoring course material (frontmatter,
wiki-links, slide markers) → `docs/standards/guides/add-a-course-document.md`;
adding a content component → `docs/standards/guides/add-a-content-component.md`
(its rules are rendered at `/catalog/governance`).

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

## Testing

Two mandatory protocols (per-commit and pre-PR) are defined in
`docs/standards/testing-strategy.md`. Tests are colocated (`Thing.test.tsx`
beside `Thing.tsx`) and run with Vitest + Testing Library.
