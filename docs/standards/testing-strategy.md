# Testing Strategy

How Nalanda is tested: the test levels, and the **two mandatory protocols** every
app must define. Decisions recorded here were agreed with Miguel (2026-08-06).

## The two-protocol rule

**Every app (and every language used in the monorepo) defines two verification
protocols in this document:**

1. **Per-commit protocol** — runs before EVERY commit (one commit = one slice).
   Nothing is committed in red. Ever.
2. **Pre-PR protocol** — runs before publishing ANY pull request. The full battery.
   CI mirrors this protocol exactly; a PR is not opened if any step fails locally.

A new app cannot merge its first PR without registering both protocols here (see
the add-new-app checklist in `repository-structure.md`).

## Test levels

| Level | Verifies | Tool | When |
|---|---|---|---|
| L1 Static | Types, lint, format | `tsc` + oxlint + prettier | Every commit |
| L2 Unit | Pure logic: parsers, registries, index walks | Vitest | Every commit (TDD red→green per slice) |
| L3 Component | Components honor their contract (e.g., per-mode rendering) | Vitest + Testing Library (jsdom) | Every commit, touched scope |
| L4 Architecture | System invariants: import direction, catalog completeness, unique ids | Vitest (pattern imported from DocumentBuddy) | Pre-PR + CI |
| L5 Browser smoke | The real app boots; key flows render in a real browser | **Playwright** (decided 2026-08-06; introduced with the first real smoke, WP2+) | Pre-PR + CI |
| L6 Backend integration | Go handlers against real SQLite + fakes | Go testing | Defined when `apps/server` is born (v0.3) |
| L7 Cross-app e2e | browser → web → server | Top-level `e2e/` | v0.3+ |
| L8 Manual | Human visual/functional verification | PR checklist | Pre-PR |

**TDD is the default working mode**: for any slice with logic, the test comes
first (red), then the implementation (green). Internal refactors lean on the
existing suite as regression guard.

**Coverage thresholds: none for now** (decided 2026-08-06). The rule is
behavioral, not numeric: every slice with logic ships tests, and review verifies
it. Numeric gates may be introduced later if drift appears.

## Protocols — `apps/web` (TypeScript)

**Per-commit** (from `apps/web/`):

```bash
npm run format:check   # prettier
npm run lint           # oxlint
npm run build          # tsc -b + vite build (type gate + content/ integrity gate:
                       # frontmatter ids and index.yaml validated by contentIntegrity)
npm run test           # vitest run — at minimum the touched scope, in green
```

**Pre-PR** (from `apps/web/`):

```bash
npm run format:check
npm run lint
npm run test           # FULL Vitest suite: unit + component + architecture
npm run build
# Browser smoke (Playwright) once it exists (WP2+)
# Manual checklist from the PR template (L8)
```

## Protocols — `apps/server` (Go) — placeholder

Born with the app in v0.3. Its author registers here the Go per-commit protocol
(`gofmt`/`golangci-lint`/`go vet`/`go test ./...` or equivalent) and the pre-PR
battery (full tests + integration L6), same rigor as `apps/web`.

## Conventions (`apps/web`)

- Tests are colocated: `Thing.test.ts(x)` next to `Thing.ts(x)`.
- Component tests assert behavior/contract (what renders per mode/props), not
  implementation details or snapshots.
- Architecture tests live in `src/` near what they guard and are named
  `architecture.test.ts` — they encode invariants agreed in standards/ADRs.
- Test fakes live next to the tests that use them (see placement criteria in
  `repository-structure.md`).

## References

- ADR-0005 (dev standards) · **ADR-0011 (toolchain decision: oxlint, Vitest, Playwright — the why)** · `frontend-code-style.md` · `repository-structure.md`
- DocumentBuddy `docs/testing-strategy.md` — source of the layered model, adapted.
