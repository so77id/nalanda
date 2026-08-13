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

**Gates in CI** (`apps/web`): `ci.yml` mirrors the pre-PR protocol on PRs and on
pushes to `main`. `deploy.yml` re-runs lint + test + build on the publish path —
CI runs in parallel on the same push and nothing consumes its result, so the
publishing job verifies itself (ADR-0015). It omits `format:check` deliberately:
formatting cannot affect the deployed artifact.

A new app cannot merge its first PR without registering both protocols here (see
the add-new-app checklist in `repository-structure.md`).

## Test levels

| Level | Verifies | Tool | When |
|---|---|---|---|
| L1 Static | Types, lint, format | `tsc` + oxlint + prettier | Every commit |
| L2 Unit | Pure logic: parsers, registries, index walks | Vitest | Every commit (TDD red→green per slice) |
| L3 Component | Components honor their contract (e.g., per-mode rendering) | Vitest + Testing Library (jsdom) | Every commit, touched scope |
| L4 Architecture | System invariants: import direction + feature edges (`src/architecture.test.ts`), content ids (`src/content/architecture.test.ts`), catalog entry shape (`src/catalog/architecture.test.tsx`), entry-chunk isolation of lazily-registered heavy components (`src/architecture.test.ts`, one case per component), MDX map ↔ catalog completeness (`src/app/mdxComponents.test.ts`), deployed build shape (`src/app/deployedApp.test.tsx`, `src/app/spaFallback.test.ts`) | Vitest (pattern imported from DocumentBuddy) | Pre-PR + CI |
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
                       # document frontmatter (id, title, presentation) and
                       # index.yaml validated by contentIntegrity)
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
- **Ordering invariants are asserted with the call still in flight.** When what a
  slice buys is *when* something happens relative to a blocking call — saved
  before the run, warmed before the click, discarded before the switch — assert
  against the intermediate state, never after the round trip: by then both
  orderings look identical. Worked case (#76): a test named "saves the editor
  before the run, not after it" stayed green with the save moved after the run,
  which is the one placement that never happens when the tab freezes. The fake
  worker already provides the seam — a message posted and deliberately left
  unanswered is the frozen tab.
- Component tests assert behavior/contract (what renders per mode/props), not
  implementation details or snapshots.
- Architecture tests live in `src/` near what they guard and are named
  `architecture.test.ts(x)` (`.tsx` when the invariant must render) — they encode
  invariants agreed in standards/ADRs. **Exception**: an invariant that binds a
  feature to the shell cannot live in the feature (features may not import
  `app/`), so it lives in the shell test that owns the pair and states its L4
  role in a comment — e.g. the MDX map ↔ catalog completeness check in
  `src/app/mdxComponents.test.ts`.
- **Build-shape invariants**: facts that only exist outside dev — the resolved
  `base`, emitted artifacts like `404.html` — are invisible to the jsdom suite,
  where `import.meta.env.BASE_URL` is always `/`. Pin them by asserting the
  resolved Vite config (import `vite.config.ts` and call it with a `ConfigEnv`)
  or by driving the plugin's hooks directly, and name the level in a header
  comment. A green jsdom suite says nothing about the deployed build.
- **Extracting a build-time value for testability moves the risk to its wiring**,
  and the wiring is pinned by resolving the config and running the plugin —
  never by matching identifier text in `vite.config.ts`. Worked case (#83): the
  remark plugin list was extracted so a test could compile MDX through it, and
  the config was guarded with `expect(config).toMatch(/mdx\(\{\s*remarkPlugins\b/)`
  over its source. Changing the build to `remarkPlugins.filter(...)` — dropping
  GFM from what is actually compiled — left lint, `tsc`, `vite build` and all 347
  tests green while the shipped document chunk fell 3.3 kB and its tables turned
  back into paragraphs of pipes. Reading a config proves a name appears in it;
  only resolving it proves the value is used (`content/mdxWiring.test.ts`).
- **Execution is invisible to the suite**: every runtime is faked in jsdom
  (`CodeEditor.test.tsx` mocks CodeMirror and the worker; `java/runtime.test.ts`
  stubs the CheerpJ globals), and jsdom has no `Worker`, no CheerpJ DOM loader
  and no network — so nothing there compiles or runs, whatever WebAssembly Node
  itself provides. A green
  suite therefore says nothing about whether code actually compiles or runs. Any
  change under `src/runtime/**`, or to a component that drives a runtime
  (`CodeEditor`, `Exercise`, `harness.ts`) or the draft store, MUST also be
  verified in a real browser against `npm run build && npm run preview` — run,
  stdin, and a deliberate compile error — per
  `guides/add-a-language-runtime.md` §7. For `Exercise`, add: a correct solution
  passes, the untouched starter fails, and a compile error surfaces as a
  diagnostic. The two verdict forgeries recorded in ADR-0019 §7 were found that
  way and were invisible to a green suite. (The browser mechanics are the
  shared ones below; the guide's §7 lists what to check for a runtime.)
- **Layout and focus are invisible to the suite**, and this is a second class
  alongside execution, not a footnote to it. jsdom lays nothing out — every box
  is 0×0, `getBoundingClientRect` returns zeros, `checkVisibility` does not
  exist, `offsetParent` is null for everything, and `window.matchMedia` is not
  implemented at all, so a component that asks for a breakpoint throws in the
  suite rather than getting a `false` — and it does not implement the browser's own tab order: it will hand
  `querySelectorAll` a link inside a **collapsed `<details>`** that a browser
  skips and `focus()` silently refuses. So a test can assert a focus trap, a
  roving tabindex, an active-section rule or a breakpoint and stay green over
  code that fails on the page. Any change that enumerates focusable elements,
  moves focus, depends on a viewport width or a scroll position, or is enforced
  by a rule in `styles/index.css`, MUST also be verified in a real browser
  against `npm run build && npm run preview`, at the widths that matter, judged
  from a screenshot. In the suite these cases are asserted **by construction** —
  place the headings and dispatch a scroll (`content/useSections.test.tsx`),
  assert the list a trap computed through where focus lands
  (`content/Drawer.test.tsx`) — and the construction must be checked against a
  browser at least once, because it encodes an assumption jsdom cannot refute.
  Three worked cases, all from #84 and all green in jsdom at the time:
  an `IntersectionObserver` active-section rule that left the rail unmarked
  through 70% of a document (an observer fires on crossings; a reader inside a
  long section crosses nothing); a focus trap that let Tab escape in Chromium to
  the toggle behind the drawer; and the first fix for it, a visibility filter on
  `offsetParent`, which under jsdom matched *nothing*, emptied the trap's list
  and made its own tests pass while proving nothing.
- **A fix is not done until its test has been seen to fail.** Revert the fix,
  watch the new test go red, restore it — and name the failing test in the
  commit message. Reviewing a test by reading it is how a test that cannot fail
  gets written: it looks like it asserts the behaviour, and it asserts something
  the implementation does anyway. Worked case (#84 review round): of eleven
  review fixes, nine were mutation-checked and held; the two that were not —
  a group summary rendering the wrong label, and the expand state keyed by
  value instead of by identity — both survived a full revert with **449/449
  green**, so the suite would have carried the defect back in silently. The
  cost is one command per fix.
- **The browser recipe lives here, not in a runtime guide.** Two failure classes
  now share it. Install once (`npm install playwright && npx playwright install
  chromium`, in a scratch directory — it is not a repo dependency; `grep
  playwright package.json` finds nothing by design), then drive `npm run build
  && npm run preview` (which serves under `/nalanda/`, like production — the
  dev server serves at `/` and exercises different paths, ADR-0015). Add
  `-- --port <n>` when something already holds 4173.
  `guides/add-a-language-runtime.md` §7 keeps the runtime-specific checks and
  points here for the mechanics.
- **Env-derived values go through a pure helper**: extract the transformation
  into a colocated, unit-tested module rather than inlining it in a component
  the suite cannot exercise. Worked case: `app/basename.ts` derives the router
  basename from `BASE_URL` (#66).
- **Registry-driven invariants**: when a standard applies to every member of a
  live registry, iterate the registry at module scope and generate one case per
  entry, so a new entry is gated the moment it is registered — never hand-write
  one test per member. Every such loop MUST be paired with a non-vacuity
  assertion (`expect(registry.length).toBeGreaterThan(0)`): a loop over an empty
  collection is a green suite that verifies nothing. Worked cases:
  `catalog/architecture.test.tsx`, `app/mdxComponents.test.ts` (#65).
- Test fakes live next to the tests that use them (see placement criteria in
  `repository-structure.md`).

## References

- ADR-0005 (dev standards) · **ADR-0011 (toolchain decision: oxlint, Vitest, Playwright — the why)** · `frontend-code-style.md` · `repository-structure.md`
- DocumentBuddy `docs/testing-strategy.md` — source of the layered model, adapted.
