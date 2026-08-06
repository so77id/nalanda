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
npm run preview      # serve the production build locally
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
├── app/                  # shell: entry, router (routes /d/:id + 404), providers
├── content/              # content pipeline: MDX registry, course index, wiki-links,
│                         # book-mode page, build-time integrity gate
├── styles/               # Tailwind entry + design tokens
├── mdx.d.ts              # module typing for *.mdx imports
└── architecture.test.ts  # import-direction invariants
```

Remaining feature folders (`components/`, `catalog/`, `presentation/`) and
`lib/` (pure TS utilities) are created by the WPs that populate them. How to
author course material: `docs/standards/guides/add-a-course-document.md`.

## Testing

Two mandatory protocols (per-commit and pre-PR) are defined in
`docs/standards/testing-strategy.md`. Tests are colocated (`Thing.test.tsx`
beside `Thing.tsx`) and run with Vitest + Testing Library.
