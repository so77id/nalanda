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
- **In the browser, the evidence is the pixels.** `getComputedStyle` reporting a
  value is not proof it was painted: it answers what the cascade resolved, not
  what the compositor drew. Anything visual is verified by taking a screenshot
  and looking at it. Worked case (#83), which cost the lesson twice in one WP:
  a focus outline on the code editor computed as `2px solid` sky-400 and was
  invisible both times — first because an ancestor with `overflow-hidden` clips
  an outline drawn outside its child, then because an opaque child paints over
  one drawn inward. Both times the DOM agreed with the intention and only the
  screenshot disagreed.
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
  moves focus, depends on a viewport width, a scroll position or a device
  capability asked through `window.matchMedia` (pointer type, orientation), or
  is enforced by a rule in `styles/index.css`, MUST also be verified in a real
  browser against `npm run build && npm run preview`, at the widths that matter,
  judged from a screenshot. In the suite these cases are asserted **by
  construction** — place the headings and dispatch a scroll
  (`content/useSections.test.tsx`), assert the list a trap computed through
  where focus lands (`content/Drawer.test.tsx`) — and the construction must be
  checked against a browser at least once, because it encodes an assumption
  jsdom cannot refute.
  Three worked cases, all from #84 and all green in jsdom at the time:
  an `IntersectionObserver` active-section rule that left the rail unmarked
  through 70% of a document (an observer fires on crossings; a reader inside a
  long section crosses nothing); a focus trap that let Tab escape in Chromium to
  the toggle behind the drawer; and the first fix for it, a visibility filter on
  `offsetParent`, which under jsdom matched *nothing*, emptied the trap's list
  and made its own tests pass while proving nothing.
- **A media query is the sharpest case of it**: the suite can pin **which
  question is asked** and fake the answer, never evaluate it, so what is
  asserted is the query string plus the behaviour that follows from a faked
  match (worked case: `presentation/usePortraitPhone.test.tsx`, #91 — dropping
  `pointer: coarse` from the query tells a laptop user to rotate their screen,
  and the string assertion is the only thing in the suite that can catch it).
  Two riders, both earned in #91's review. **Guard the call**:
  `window.matchMedia` is universal in browsers, so the `typeof` check exists
  purely so jsdom answers `false` instead of throwing, and `vitest.setup.ts` is
  confirmation-gated (`apps/web/CLAUDE.md`), which is why the accommodation
  lives in the code. **Make the fake answer only its own query**: one that
  returns the same `matches` for every question also answers framer-motion's
  `(prefers-reduced-motion)` when the component under test mounts, silently
  changing it — worked case `app/presentationRoute.test.tsx`, whose fake scopes
  its answer to `pointer: coarse`, which the hook's own fake does not need
  because its harness renders no motion component.
- **A browser-API fake needed by two features is duplicated, not shared.** The
  seam invariant in `src/architecture.test.ts` has no `.test.` exemption for the
  "goes through the feature root seam" case, so a shell test cannot import a
  helper out of a feature folder, and `lib/` is for shipped pure code, not test
  doubles. Worked case (#91): the `matchMedia` fake exists in
  `app/presentationRoute.test.tsx` and in `presentation/usePortraitPhone.test.tsx`,
  and they are not identical — only the second tracks which queries were asked.
- **Asserting ABSENCE inside a lazy boundary needs a synchronisation point.**
  `queryBy…` returns nothing while a `Suspense` child is still loading, so the
  assertion passes before the code under test has run at all. First `await` an
  element that can only exist on the far side of the boundary, and say so in a
  comment. Worked case (#91): `app/presentationRoute.test.tsx` awaits the rotate
  panel — which only the loaded document can render — before asserting that no
  counter and no slide heading are on the page.
- **A per-state browser measurement is not a transition measurement.** Loading
  each state fresh (`?slide=1`, `?slide=2`, …) exercises mount and nothing else;
  the paths BETWEEN states are different code and have to be driven in the same
  page — press the key, dispatch the gesture, rotate the context. Worked case
  (#99): thirty fresh-load measurements across ten slides and three viewports
  reported "no overflow anywhere" while the deck was broken on every path a
  reader actually takes — rotating into it left the slide at scale 1 overflowing
  its stage 3:1, and pressing an arrow key measured the outgoing slide. One run
  that pressed ArrowRight instead of reloading showed it immediately.
- **A guard whose predicate is a DOM measurement is verified against the
  property it claims to measure, not against itself.** The suite can pin which
  nodes a walk visits; only a browser can say whether those nodes behave the
  way the predicate assumes. The recipe has two legs, and each proves a different
  thing: set `el.scrollLeft = 30` and read it back, AND drive a real touch drag.
  A box that returns 0 to both was never scrollable (`overflow-x: visible`); a
  box that moves under the assignment but not under the drag clips without
  panning (`overflow-x: hidden` — measured at 30 and 0). Running only the first
  leg calls `hidden` scrollable, which is how a predicate about what a READER
  can drag ends up trusting a number instead of the computed `overflow-x`. Worked case (#103): `scrollWidth > clientWidth` was true
  for an `overflow-x: visible` wrapper that neither an assignment nor a real
  touch drag could move, and the jsdom fakes had pinned that false positive as
  the intended contract. The same run over every slide of every document is
  what sized the finding — the predicate was wrong and today's content happened
  not to trigger it.
- **A measure-and-observe effect is keyed on the identity of the node it
  measures**, never on a scalar that merely correlates with it (an index, a
  length). And this class IS reachable from jsdom, which is what makes it worth
  a test: stub `ResizeObserver`, define `clientWidth`/`offsetHeight` getters on
  `HTMLElement.prototype`, and assert WHICH element was measured and observed —
  jsdom cannot lay out, but it can answer that. Worked case (#99):
  `app/presentationRoute.test.tsx` §"fitting a slide to the stage it is shown
  on", where the rotation case fails against the index-keyed version.
- **Nothing — a fix or a guard — is done until its test has been seen to fail.**
  Revert the fix (or introduce the defect the guard names), watch the test go
  red, restore it — and name the failing test in the commit message. Do this on
  a **committed** tree and restore with `git checkout --`: that command reverts
  everything uncommitted under the path, so mutating before committing eats the
  test you are trying to prove (#87 lost a slice's tests exactly this way; see
  `docs/conventions.md` §Worktrees). Reviewing a test by reading it is how a test that cannot fail
  gets written: it looks like it asserts the behaviour, and it asserts something
  the implementation does anyway. Worked case (#84 review round): of eleven
  review fixes, nine were mutation-checked and held; the two that were not —
  a group summary rendering the wrong label, and the expand state keyed by
  value instead of by identity — both survived a full revert with **449/449
  green**, so the suite would have carried the defect back in silently. The
  cost is one command per fix.
- **Headless Chromium has no browser chrome.** Any question about the browser's
  own bar — does it hide on scroll, does it overlay the page — is unanswerable
  there and comes back a false success; it is a real-device observation,
  recorded with the browser, the OS and the date. Worked case (#103): `dvh` +
  `viewport-fit=cover` measured clean in emulation, and the bar was still over
  the deck on an iPhone (ADR-0023).
- **The browser recipe lives here, not in a runtime guide.** Two failure classes
  now share it. Install once (`npm install playwright && npx playwright install
  chromium`, in a scratch directory — it is not a repo dependency; `grep
  playwright package.json` finds nothing by design), then drive `npm run build
  && npm run preview` (which serves under `/nalanda/`, like production — the
  dev server serves at `/` and exercises different paths, ADR-0015). Add
  `-- --port <n>` when something already holds 4173.
  **Stop it by port, never by pattern**: `lsof -ti tcp:<n> | xargs kill`. Other
  WPs and the review lenses run their own preview servers in parallel worktrees,
  so `pkill -f "vite preview"` takes every one of them down — in #87 two sessions
  did it to each other inside an hour (`docs/conventions.md` §Worktrees).
  `guides/add-a-language-runtime.md` §7 keeps the runtime-specific checks and
  points here for the mechanics.
  **A device rule needs an emulated device, not a small window.** A desktop
  context reports `pointer: fine` at any size, so resizing Chromium to 390x844
  proves nothing about a phone — the check silently passes over code that never
  ran. Use a touch context (`browser.newContext({ ...devices['iPhone 13'] })`,
  or `{ viewport, hasTouch: true, isMobile: true }`), rotate by swapping width
  and height **in the same context** so the page is not remounted, and run the
  same page once in a default desktop context to prove the rule does NOT fire on
  a narrow laptop window. Two mechanics worth knowing before they cost an hour
  (#91): on a **fullscreen** page the driver's resize call rejects
  (`Browser.setWindowBounds`: "To resize minimized/maximized/fullscreen window,
  restore it to normal state first") *after* the metrics override has already
  landed — so the page has rotated, the app has reacted, and the script dies
  holding a state it thinks it never reached. Rotate a fullscreen page through
  `Emulation.setDeviceMetricsOverride` on a CDP session instead. And the
  emulated rotation is what makes `matchMedia` fire, so assert the query's own
  value in the page (`matchMedia('(pointer: coarse)').matches`) rather than
  trusting the preset.
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
  `catalog/architecture.test.tsx`, `app/mdxComponents.test.ts` (#65). A
  non-vacuity guard carries a **message naming the test to write when it trips**,
  not a bare check — the day it fires, whoever hits it is not the person who knew
  why it was there. Worked case (#87): `expect(empty, 'every family now has
  components — cover the empty branch with a direct FamilyPage test')`.
- **Assert where the fact belongs, not that it appears somewhere.** A page-wide
  `getAllByText(...)` proves a string exists on the page; it does not tie the
  string to the row that must carry it. Scope with `within(...)` on the element
  that owns the fact, and assert **both directions** — present where it should
  be, absent where it should not. Worked case (#87): the overview's
  empty-by-design note was asserted by counting matches page-wide, and with two
  empty and two populated families the count survives putting the note on
  exactly the wrong half — 464 tests green while every fact sat on the wrong
  family. The same shape hid a swapped component count.
  Second worked case (#87): four tests written across S3–S7 stayed green through
  the exact defect each was named for — every one asserted that a string appeared
  *somewhere* rather than in the place that had to carry it — and the slice that
  fixed them exists only because a review lens mutated the code instead of
  reading it.
- **An invariant with a deliberate exception splits by level.** Put the
  data-level half with the feature that owns the data, and the render-level half
  in the shell test that can actually exclude the exception — each naming its
  counterpart in a comment, because half a guard looks like a whole one. Worked
  case (#87): the catalog is English, but a component page renders live widgets
  whose chrome is Spanish on purpose. `catalog/architecture.test.tsx` scans the
  registry strings; `app/catalogRoute.test.tsx` scans what the pages render and
  skips `/catalog/c/:name`. One guard covering both would have to choose between
  missing the pages and flagging the exception.
- **Pin a deliberate break.** When a change removes a route, a contract or a
  compatibility path on purpose and ships no shim, assert the new behavior with
  a test that carries the reason — so the break is something the suite states
  rather than something a reader discovers, and so restoring it later is a
  conscious deletion. Worked case (#87): `it.each(['estructura', …])` asserts
  the old catalog segments 404, with the no-redirect rationale above it.
- Test fakes live next to the tests that use them (see placement criteria in
  `repository-structure.md`).

## References

- ADR-0005 (dev standards) · **ADR-0011 (toolchain decision: oxlint, Vitest, Playwright — the why)** · `frontend-code-style.md` · `repository-structure.md`
- DocumentBuddy `docs/testing-strategy.md` — source of the layered model, adapted.
