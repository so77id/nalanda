# CLAUDE.md — apps/web

The Nalanda platform frontend. Read the root `CLAUDE.md` first for monorepo-shared
rules; this file covers what is specific to this app.

## Commands (run from `apps/web/`)

```bash
npm install          # dependencies
npm run dev          # Vite dev server (localhost:5173)
npm run build        # tsc -b (type gate) + vite build → dist/
npm run preview      # serve the production build locally
npm run lint         # oxlint
npm run format       # prettier --write
npm run format:check # prettier --check
npm run test         # vitest run (full suite)
npm run test:watch   # vitest watch mode
```

## Stack

React 19 · TypeScript (strict) · Vite · Tailwind CSS v4 (`@tailwindcss/vite`,
CSS-based config — no tailwind.config.js) · framer-motion (the ONLY animation
library) · react-router-dom · oxlint + Prettier · Vitest + Testing Library.

## Mandatory reading

- `docs/standards/frontend-code-style.md` — folder layout (`src/app|components|catalog|content|presentation|lib|styles`), naming, component rules, import direction (`app → features → lib`). **Follow, don't innovate.**
- `docs/standards/testing-strategy.md` — the `apps/web` per-commit and pre-PR protocols. Nothing is committed in red.

## App-specific rules

- Do not modify `vite.config.ts`, `tsconfig*.json`, or `.prettierrc.json` without
  user confirmation (dependency changes are governed by the root rule).
- Logging: `console.log/info/warn/error` only while debugging — never left in
  committed code; never log secrets or personal data.
- Tests are colocated (`Thing.test.tsx` beside `Thing.tsx`); component tests
  assert contract/behavior, not implementation details.
