# CLAUDE.md — apps/web

The Nalanda platform frontend. Read the root `CLAUDE.md` first for monorepo-shared
rules; this file covers what is specific to this app.

## Commands & stack

Single home: [`README.md`](./README.md) — read it for the command list and the
stack summary before working here (one home per fact, per
`docs/standards/documentation.md`).

## Mandatory reading

- `docs/standards/frontend-code-style.md` — folder layout (`src/app|components|catalog|content|presentation|lib|styles`), naming, component rules, import direction (`app → features → lib`). **Follow, don't innovate.**
- `docs/standards/testing-strategy.md` — the `apps/web` per-commit and pre-PR protocols. Nothing is committed in red.

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
