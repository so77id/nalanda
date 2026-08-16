# Testing Strategy

How Nalanda is tested: the test levels, and the **two mandatory protocols** every
app must define. Decisions recorded here were agreed with Miguel (2026-08-06).

## The two-protocol rule

**Every app (and every language used in the monorepo) defines two verification
protocols in this document:**

1. **Per-commit protocol** — runs before EVERY commit (one commit = one slice).
   Nothing is committed in red. Ever. A slice that only pins a defect therefore
   cannot stand alone — see `docs/conventions.md` §Commit format.
2. **Pre-PR protocol** — runs before publishing ANY pull request. The full battery.
   CI mirrors this protocol exactly; a PR is not opened if any step fails locally.

**Gates in CI** (`apps/amc-worker`): `.github/workflows/amc-worker.yml`, filtered
on `apps/amc-worker/**`, runs `make verify PLATFORM=linux/amd64` — the runner is
amd64 and the Makefile defaults to arm64. It also runs `make measure COPIES=5`,
which is deliberately outside both protocols: a measurement is reported so a
regression in the pipeline's cost is visible in the log, never gated.

**Gates in CI** (`apps/web`): `ci.yml` mirrors the pre-PR protocol on PRs and on
pushes to `main`. `deploy.yml` re-runs lint + test + build on the publish path —
CI runs in parallel on the same push and nothing consumes its result, so the
publishing job verifies itself (ADR-0015). It omits `format:check` deliberately:
formatting cannot affect the deployed artifact.

A new app cannot merge its first PR without registering both protocols here (see
the add-new-app checklist in `repository-structure.md`).

## Test levels

| Level                  | Verifies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Tool                                                                            | When                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| L1 Static              | Types, lint, format                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `tsc` + oxlint + prettier (`apps/web`) · `gofmt -l` + `go vet` (`apps/server`)   | Every commit                              |
| L2 Unit                | Pure logic: parsers, registries, index walks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Vitest                                                                          | Every commit (TDD red→green per slice)    |
| L3 Component           | Components honor their contract (e.g., per-mode rendering)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Vitest + Testing Library (jsdom)                                                | Every commit, touched scope               |
| L4 Architecture        | System invariants. **`apps/server`**: the three dependency edges of ADR-0034, walked over the real package graph and transitive, with both a non-vacuity guard and a second independent directory walk that must agree with it (`internal/architecture_test.go`). **`apps/web`**: import direction + feature edges (`src/architecture.test.ts`), content ids, declared question coverage and the mechanical question rules (`src/content/architecture.test.ts`), catalog entry shape (`src/catalog/architecture.test.tsx`), entry-chunk isolation — a per-component case for each lazily-registered heavy component, **plus** a walk of everything the shell reaches eagerly from `app/main.tsx` (both in `src/architecture.test.ts`): it never reaches `runtime/`, and it pulls in no bare package outside `SHIPS_EAGERLY`, MDX map ↔ catalog completeness (`src/app/mdxComponents.test.ts`), deployed build shape (`src/app/deployedApp.test.tsx`, `src/app/spaFallback.test.ts`), every published document renders with no authoring error (`src/app/contentRenders.test.tsx`) — it mounts `AppRoutes`, because a document body may use any shell-registered component and a feature-local MDX map would pass vacuously, the two readers of a question agree on every published document and the section spine is the same on both sides (`src/app/questionReaders.test.tsx`) — same reason for living in the shell, and it must go through the MDX **provider**, since `<Slide>` reads its `h2` from that context and would otherwise render a bare heading with no id | Vitest (pattern imported from DocumentBuddy)                                    | Pre-PR + CI                               |
| L5 Browser smoke       | The real app boots; key flows render in a real browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Playwright** (decided 2026-08-06; introduced with the first real smoke, WP2+) | Pre-PR + CI                               |
| L6 Backend integration | Go handlers against real SQLite: the composed root mux over both surfaces and the §C12 seam in both directions — the API answers with no session, the backoffice's state-changing route does not (`cmd/server/main_test.go`); `/health` through the real prober and a database that goes away (`internal/app/web/health_integration_test.go`); migrations applied and re-applied over a temp file, plus the upgrade over a database that ran #149's placeholder (`internal/infra/storage/sqlite_test.go`, `schema_test.go`); the auth repositories against a real file, including a sweep proving the raw session token is in no column (`internal/infra/storage/authstore/`); the cookie → professor resolution and the CSRF refusal (`internal/app/web/middleware/`); the whole login round trip against a mock provider (`internal/app/web/handler/`, `internal/domain/auth/login_test.go`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Go testing                                                                      | Every commit + pre-PR (`-race -count=1`)  |
| L7 Cross-app e2e       | browser → web → server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Top-level `e2e/`                                                                | v0.3+                                     |
| L8 Manual              | Human visual/functional verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PR checklist                                                                    | Pre-PR                                    |

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
                       # document frontmatter (id, title, presentation, questions)
                       # and index.yaml validated by contentIntegrity; ALSO fails on
                       # a duplicate question id, which the suite does not see —
                       # it is the join key into a grade, so it fails the build)
npm run test           # vitest run — at minimum the touched scope, in green
```

**Green means exit status 0, not the summary line.** An unhandled rejection
makes vitest exit 1 while counting every test as passed; the cause appears only
in its `Unhandled Errors` block and an `Errors 1 error` line, both of which scroll
past. Check `echo $?`, or run the protocol under `set -e`. See §Conventions,
"a promise that can reject". Worked case #98, where the mode was discovered by a
review rather than by the protocol that is supposed to catch it.

**Pre-PR** (from `apps/web/`):

```bash
npm run format:check
npm run lint
npm run test           # FULL Vitest suite: unit + component + architecture
npm run build
# Browser smoke (Playwright) once it exists (WP2+)
# Manual checklist from the PR template (L8)
```

## Protocols — `apps/amc-worker` (container + shell)

**Per-commit** (from `apps/amc-worker/`):

```bash
make test              # every tests/NN-*.sh against the current image
```

**`make build && make test` whenever the change touches `worker.py`,
`read_capture.py` or the `Dockerfile`.** `make test` does not rebuild, so a
change that was never built goes green — and "green before commit" then
authorises the commit. This is the operating consequence of the artifact rule
below; it is stated here too because the rule below is written for whoever
writes a test, and this is for whoever edits the code.

**Pre-PR** (from `apps/amc-worker/`):

```bash
make verify            # rebuild the image, then the full set (Docker's layer
                       # cache applies — add --no-cache by hand when the apt
                       # layer is what you doubt)
```

**Green means exit status 0.** Each script prints `N checks, M failed` and exits
non-zero when `M > 0`; the summary line is not the gate.

**The tests are shell scripts, not a framework.** What is under test is a
container image and a third-party CLI (Auto-Multiple-Choice) — the subject is
`docker run`, and a framework would only wrap it. One script per acceptance
criterion of the WP that introduced the behavior, each re-runnable alone.

**A measurement is reported, never asserted.** Image size and batch timings are
printed with `note` and collected in the ADR; they are not thresholds. A test
that reddens because a number moved teaches nothing about correctness, and the
numbers that matter here (does reading 40 sheets take three minutes or forty)
are decisions for a human, not gates.

**A wrapper that exists to neutralise a third-party trap is tested by
PERFORMING the trap, not by reading the wrapper.** `04-associate.sh` is the
worked case: it makes the wrong call (`association --set` without `--copy`) and
asserts its wrong outcome in three independent channels — it prints nothing, it
writes a `copy=0` row, the copy stays unassociated — before asserting the right
call works. That is what makes the guard falsifiable: if a future upstream
release fixes the trap, or breaks it differently, the test says which. The
counter-example is in the same WP and was caught in review: the closed-subcommand
guard was asserted by `grep`ping the wrapper's source for its error message,
which passes with the guard commented out and reads a different copy of the file
than the container runs. Same rule as "reading a config proves a name appears in
it" above, one level up.

**A test runs against the ARTIFACT, not the working tree.** `make test` does not
rebuild, so a script that mounts a source file from the host and executes that
is green against a stale image — which is the per-commit protocol's normal
state. Production code is invoked from where the image installed it; only test
tools travel on the volume (#138 review).

That makes "seen to fail" look expensive, because reddening a check appears to
need a full `make build`. It does not: a **derived image** keeps the artifact
rule intact and costs seconds (#147 review).

```bash
# From apps/amc-worker/. The Dockerfile goes OUTSIDE the tree: written here it
# would overwrite apps/amc-worker/Dockerfile, which is that app's dependency
# manifest and which the root CLAUDE.md forbids modifying.
mkdir -p /tmp/amc-mutant
printf 'FROM nalanda/amc-worker:dev\nCOPY read_capture.py /opt/amc-worker/read_capture.py\n' \
  > /tmp/amc-mutant/Dockerfile
docker build -q -f /tmp/amc-mutant/Dockerfile -t nalanda/amc-worker:mutant .
AMC_IMAGE=nalanda/amc-worker:mutant tests/03-read.sh
```

Break the production copy, build one layer, run the script against it. In #147
this is what found two assertions that could not fail — one that a hardcoded
denominator satisfied, and one where the reader could emit an empty report on
exit 0 — neither of which reading the diff had surfaced.

**A fixture added to kill a mutant names that mutant, at the fixture.** When the
answer to "this assertion cannot fail" is a new fixture rather than a new
assertion, its header says which mutant survived, that it survived the whole
suite, and why the case is a separate file instead of folded into the existing
one. `apps/amc-worker/tests/fixtures/control-tres.tex` is the worked example: it
exists only because every question in the main pool has four alternatives, so a
reader hardcoding `4` passed all 53 checks.

**What this level cannot see**: everything about a real sheet. The scripts drive
synthetically-filled PDFs — boxes drawn at the coordinates AMC's own layout file
reports — which proves the plumbing and nothing about paper. Whether the reader
tolerates a real pencil, a real scanner and a page that went in slightly rotated
is an L8 manual check, and it is the one that decides the engine. The procedure
is `apps/amc-worker/PAPER-CHECK.md` (`make paper` → print → mark → scan →
`make read-paper`); its outcome is recorded in ADR-0030 §Not yet proven. Same class as
"execution is invisible to the suite" above: a green run here is not evidence
the thing works.

## Protocols — `apps/server` (Go)

Born with the app in #149. Style rules for the tests themselves live in
`backend-code-style.md` §Testing.

**Per-commit** (from `apps/server/`):

```bash
test -z "$(gofmt -l .)"   # MUST print nothing — see below
go vet ./...
go build ./...
go test ./...             # at minimum the touched scope, in green
```

**`gofmt -l` exits 0 whether or not it found anything.** It reports by printing
filenames, so `gofmt -l .` as a protocol step is green over an unformatted tree
and CI has to test its OUTPUT rather than its status
(`.github/workflows/server.yml`). Locally the gate is that the command prints
nothing.

**Pre-PR** (from `apps/server/`):

```bash
test -z "$(gofmt -l .)"        # see below: `gofmt -l` alone is not a gate
go vet ./...
go test -race -count=1 ./...   # FULL suite: unit + L4 architecture + L6
go build ./...
go run golang.org/x/vuln/cmd/govulncheck@latest ./...   # same gate as CI; needs network
docker build -t nalanda/server:dev .
# then the compose path (L8), from infra/local/:
#   docker compose up -d --wait server \
#     && curl -fsS http://127.0.0.1:8081/health \
#     && curl -fsS http://127.0.0.1:8081/api/health
```

**`govulncheck` is in the protocol, not only in CI.** It covers the dependency
tree AND the standard library of the toolchain `go.mod` declares — the pair that
drifted in this app's first WP, where `go.mod` said 1.25.7 while the pinned
builder shipped 1.25.13 and the gap contained a `net/http` fix to how
`ReadHeaderTimeout` is applied. A hit is resolved by raising the toolchain or the
dependency (`backend-code-style.md` §Version), never by suppressing it. It is
listed here because a contributor who ran the documented battery green must not
then fail CI on a gate no document mentions.

**When the Dockerfile's builder digest changes, check it against `go.mod`:**

```bash
docker run --rm golang:1.25-alpine@<digest> go version   # must be >= go.mod's
```

The digest names no version and `1.25-alpine` is a moving tag, so nothing else
surfaces a mismatch: `docker build` succeeds either way.

**`-count=1` is not optional in the pre-PR run, and the reason is specific.**
`internal/architecture_test.go` reads the source tree rather than importing it.
Go's build cache keys a test package on its own inputs, so a package that
imports nothing from the module counts as unchanged whatever happens to the
code — and an earlier revision that shelled out to `go list` replayed a cached
PASS through four real dependency-rule violations (#149 S5). The file was
rewritten to read files with `go/parser`, which the cache does track, and
`-count=1` is the belt to that braces.

**`-race` in the pre-PR run only.** The server starts a goroutine per connection
and one for the accept loop; the detector costs several seconds and finds
nothing on most commits, which is the shape of a check that belongs in the wider
battery rather than in every commit.

**The image is built and RUN, not only built.** `CGO_ENABLED=0` is what lets the
binary run on `scratch`; a dependency that needs CGO produces a build that
succeeds and a container that cannot start, and no compile step notices. CI runs
the image and probes `/health`; the human runs it through compose.

**Green means exit status 0** — with the `gofmt` exception above, which is the
one step in this protocol whose status lies.

**Gates in CI** (`apps/server`): `.github/workflows/server.yml`, filtered on
`apps/server/**`, mirrors the pre-PR protocol. `infra/local/docker-compose.yml`
is deliberately NOT in its path filters: the file is shared with
`apps/amc-worker` and the job does not run it — the compose path is the human's
L8 check.

**What this level cannot see.** The suite drives `httptest` recorders and
temporary SQLite files. It says nothing about the container: whether the binary
starts on `scratch`, whether the unprivileged UID can write the volume, whether
the healthcheck the compose file names exists in the image at all. That last one
did not exist when the compose file first referenced it (#149 S6), and only
running the thing said so — which is why the pre-PR protocol ends in Docker
rather than in `go test`.

## Conventions (all apps)

These were learned in one app and apply to every one. They sit above the
per-app sections because a rule filed under `apps/web` is a rule the Go author
never reads, and two of the three below have Go worked cases.

- **A guard reads what it guards through the test runner's own file access,
  never through a subprocess.** A test package that imports nothing from the
  code it checks is considered UNCHANGED by the build cache whatever happens to
  that code, and a subprocess is invisible to the cache's input tracking — so
  the runner replays a cached PASS. Worked case (#149): an architecture guard
  built on `go list` replayed a green result through four real dependency-rule
  violations; rewritten to read the files with `go/parser`, the same mutations
  go red without even needing `-count=1`. The rule is language-neutral: it
  applies to any check that shells out to learn what it is asserting about.
- **When a comment claims a property the suite does not pin, the comment says so
  — and says why the distinguishing case is unreachable.** A comment that
  promises a guarantee the tests do not hold is worse than no comment, because
  the next reader treats it as verified. Worked case (#149):
  `storage.Prober` explains why it runs a `SELECT` rather than `Ping`, and then
  states plainly that swapping the two leaves every test green, because telling
  them apart needs a database gone from under a live connection and SQLite's
  open file descriptor makes that unreachable from a test.
- **An acceptance criterion discharged by DIFFERENT behaviour than it specifies
  is closed by naming the substitute test and the mutation that kills it.** Not
  by arguing the substitute is equivalent. Worked case (#149): AC-3 asked for a
  non-200 from `/health` on an unwritable database path; the server refuses to
  start instead, and the AC was closed with the test that covers the situation
  that does occur in operation — a database that goes away after boot — plus
  the mutation showing it red.

## Conventions (`apps/web`)

**Two readers of one authored artifact are cross-checked over the REAL content,
never each against its own fixtures.** Hand-built fixtures agree by construction
and diverge in production. The shape: walk the live registry, compare the id
sets first with a message naming the divergence class, then field by field under
a normaliser, with a non-vacuity guard. Worked case: a question is read twice on
purpose — `content/questionSource.ts` from the MDX source for the gates and the
printed control, `lib/questions.ts` from the rendered tree for the page — and
nothing compared them (#139). Four divergences were shipping, the worst of them
student-facing: blank lines between alternatives make markdown emit a loose list
that wraps each item in a `<p>`, so every alternative read as incorrect and a
student marking the right answer was told they were wrong. Valid markdown,
page-only, invisible to every other gate.


- Tests are colocated: `Thing.test.ts(x)` next to `Thing.ts(x)`.
- **Ordering invariants are asserted with the call still in flight.** When what a
  slice buys is _when_ something happens relative to a blocking call — saved
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
- **A role query with a `name` matcher throws over mathematics.** jsdom's
  `getComputedStyle` cannot handle a MathML-namespace node, and Testing Library
  calls it (via `isInaccessible`) whenever it has to compute an accessible name.
  So `getByRole('heading', { name: /Costo/ })` over a heading containing a
  formula fails with `TypeError: Cannot read properties of undefined (reading
'length')` — a message that names neither the query nor the formula. Dropping
  `{ name }` passes; so does `getByText`, and so does every query that never
  reaches the MathML subtree. Discovered in #118 and worth knowing before #120,
  which puts formulas on many slides and headings: the fix is to assert on text
  or on a `data-testid`, not to conclude the component is broken.
- **A feature spread across several independently-deletable pieces is pinned by
  deleting each one.** Not by reading the tests: by removing a piece, running the
  suite, and checking something goes red — a piece whose deletion turns nothing
  red is not pinned, whatever its test is named. Worked case (#118): mathematics
  needs a remark plugin, a rehype plugin and an option, and all three deletions
  were verified to go red at both levels. The same exercise found the hole — an
  "inline mathematics" case that passed when fed display mathematics, because
  both carry the same class.
- **Execution is invisible to the suite**: every runtime is faked in jsdom
  (`CodeEditor.test.tsx` mocks CodeMirror and the worker; `java/runtime.test.ts`
  stubs the CheerpJ globals), and jsdom has no `Worker`, no CheerpJ DOM loader
  and no network — so nothing there compiles or runs, whatever WebAssembly Node
  itself provides. A green
  suite therefore says nothing about whether code actually compiles or runs. Any
  change under `src/runtime/**`, or to anything that **drives** a runtime — calls
  `run()` through `useRuntime`/`useLoadedRuntime`, generates a compilation unit
  sent to one (`harness.ts`, `trace.ts`), or mounts `CodeEditor` — or to the
  draft store, MUST also be verified in a real browser against `npm run build &&
npm run preview` — run, stdin, and a deliberate compile error — per
  `guides/add-a-language-runtime.md` §7. Today that set is `CodeEditor`,
  `Exercise` and `MemoryDiagram`. Define it by what the code DOES: worded as
  "mounts `CodeEditor`" it silently excluded `MemoryDiagram`, which draws its own
  listing (ADR-0028) and drives a JVM end to end.

  For `Exercise`, add: a correct solution passes, the untouched starter fails,
  and a compile error surfaces as a diagnostic. The two verdict forgeries
  recorded in ADR-0019 §7 were found that way and were invisible to a green
  suite.

  For `MemoryDiagram`, add: the listing shows no `// foto` markers and keeps
  every line number, the photographs walk forwards and back with the right line
  lit, an aliasing example draws two names on one box, and a run that hit any cap
  says so instead of claiming `paso N de N`. That last one is not paranoia —
  every one of those failures shipped past a green suite in #116 and was found
  in a browser.
  (The browser mechanics are the shared ones below; the guide's §7 lists what to
  check for a runtime.)

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
  `offsetParent`, which under jsdom matched _nothing_, emptied the trap's list
  and made its own tests pass while proving nothing.
- **A document from a third origin is invisible to everything**, and this is a
  third class, added in #146 when the repo grew its first `<iframe>`. jsdom has
  no network and never loads a frame, so the suite can pin the attribute
  **string** and nothing about its effect; and unlike the two classes above, a
  browser does not close the gap either, because Playwright cannot query across
  the origin — it can see that a frame is there, not what it says. So a sheet
  that stopped being shared, a url the vendor refuses, an outage, and the
  content itself all pass a fully green suite AND a DOM-level browser check.
  **The evidence is the pixels and the network log**, which is why the browser
  pass for this class is a screenshot somebody looks at plus a request/byte
  count from a cold profile.

  What must be re-measured whenever such a component changes, all four earned in
  #146 (ADR-0035) and none of them visible to any test: that the frame paints at
  all; what each `sandbox` token actually permits — `allow-popups` without
  `allow-popups-to-escape-sandbox` opened a link and broke the page it opened,
  and both spellings pass every assertion; the network weight, since one frame
  cost ~570kB against a 190kB page; and whether `loading="lazy"` defers
  anything, since on an iframe it defers nothing until roughly 4000px below the
  fold. A fifth, if the component can appear on a slide: a real touch drag
  inside the frame, because the deck's swipe rule (ADR-0013 §5.2) is written
  about scrollers in **this** document and a cross-origin one is invisible to it.

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
- **Asserting ABSENCE across ANY async boundary needs a synchronisation point**
  — a lazy chunk, or simply a state transition the assertion does not wait for.
  `queryBy…` returns nothing while a `Suspense` child is still loading, so the
  assertion passes before the code under test has run at all. Second worked case
  (#135): after `End` in a deck, `queryByText` ran before the last slide painted,
  so the negative assertion could not fail whatever the slide contained — found
  by moving the closing prose INSIDE the last `<Slide>` and watching it stay
  green. First `await` an
  element that can only exist on the far side of the boundary, and say so in a
  comment. Worked case (#91): `app/presentationRoute.test.tsx` awaits the rotate
  panel — which only the loaded document can render — before asserting that no
  counter and no slide heading are on the page.
  Steps 1 **and** 2 below settle the absence case too — step 1 alone does not:
  without the flush the first commit is still the fallback, so `queryBy` passes
  vacuously, which is the false pass this bullet exists to forbid (verified).
  Reach for the far-side `await` when one test in a file crosses the boundary,
  and for the file-wide pair when many do.
- **Asserting PRESENCE across one has the mirror hazard: the assertion is a
  deadline, and the module is racing it.** `findBy*` waits 1000ms by default,
  which is not a fact about the code but about the machine — on a busy box the
  chunk arrives later and the case reddens for no reason anyone can reproduce.
  Do not raise the timeout; it hides this case and the next. Three steps, and
  **the second is the one everybody drops**:

  1. Resolve the modules once for the file —
     `beforeAll(() => Promise.all(registry.entries.map((e) => e.load())))`.
     Once per file, not per call site: a step a call site has to remember is a
     step the next render will not get.
  2. Render inside `await act(async () => { render(…) })`. **`React.lazy`
     suspends even when the module is already cached**, so the boundary does
     _not_ settle on the first commit — it settles on the retry the flush
     delivers. Skip this and step 3 becomes impossible: with the preload in
     place and the flush removed, a `getBy` finds the fallback and fails
     (verified by mutation). A file that stays entirely on `findBy` is already
     fixed by step 1 alone — the flush is what buys you the canary.
  3. Keep **one canary assertion per file on `getBy`**. A query that cannot wait
     is the only one that can prove the wait is gone; with `findBy` the test
     passes either way and proves nothing. The rest may stay on `findBy` —
     converting them all is churn, and converting them without step 2 is red.

     **Assert something only the loaded module renders.** A canary on the
     shell's own markup proves nothing: `getByRole('article')` passes with the
     preload deleted, because the article exists before its lazy document does.
     An `h2` from the document does not. This was got wrong first here, and the
     mutation caught it — which is why step 4 exists.

  4. **Delete the preload and watch the canary fail.** Without this the canary
     is decoration: two of the four written for #102 asserted shell markup and
     passed with the preload gone.

  **Prove it in both directions rather than asserting it.** Patch each entry so
  its FIRST resolution is delayed and later calls are served from cache, which
  is how `import()` really behaves:

  ```ts
  for (const entry of registry.entries) {
    const real = entry.load;
    let cached: ReturnType<typeof real> | undefined;
    entry.load = () =>
      (cached ??= new Promise((r) => setTimeout(() => r(real()), 1500)));
  }
  ```

  It has to run **before the first render** — `content/lazyDoc.ts` captures
  `entry.load` when it calls `lazy()` — so put it at the top of the test file
  (no config needed), or in a scratch setup file pointed at by a throwaway
  config: `test.setupFiles: ['./vitest.setup.ts', './src/slowLoad.ts']`. Vitest 4
  has no `--setupFiles` flag.

  That turns "seen three times, never reproducible" into one command, and it
  also separates the files genuinely at risk from those that merely look
  similar. Worked case (#102): the cover-slide case in
  `app/presentationRoute.test.tsx` reddened three times on loaded machines, once
  at 1402ms, gating the pre-PR protocol and CI with it. Under the simulation the
  unfixed shape fails with that same message and the fixed one passes.

  The same probe found `app/App.test.tsx`, `app/documentSections.test.tsx` and
  `app/documentDrawer.test.tsx` exposed — the last one waits on `h2[id]`, i.e.
  _inside_ the boundary, on `waitFor`'s same default budget — and cleared
  `documentBreadcrumb` and `documentTitle`, whose queries hit the shell's nav
  and `document.title`. **Calibrate the delay before trusting a clearance**: at
  1500ms `documentDrawer` looked clear and at 4000ms it failed, so the first
  answer was an artefact of the number, not a property of the file. It was
  written into this standard as "its assertions sit outside the boundary", which
  was simply false.

  `app/documentFences.test.tsx` is the same hazard over a different module — the
  fence renderer, not the document — and was flaky on `main` before this WP:
  2 failures in 4 runs of `src/app/`. Its fix is the same shape,
  `await import('../components/interactive/CodeEditor')`.

  Apply the steps to a file when a case there has reddened under the probe, or
  when you want a `getBy` canary — not to every file that contains a `findBy`.

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
- **A test that hands the code a short real timeout is racing the machine.**
  A budget the production code arms with `setTimeout` is wall clock, so any
  assertion that must happen INSIDE it is a bet on how busy the box is. Give
  each phase of a test the budget its own question needs — the phase that must
  time out gets a small one, the phase that must succeed gets a large one — and
  make the load explicit by waiting longer than the small budget where the gap
  opens. Worked case (#98): one test handed both its runs 20ms, so the second
  one, the one that had to succeed, failed on the two occasions it was seen —
  both with review agents building in parallel — and passed 10/10 on an idle
  machine. Synthetic load reproduces it only sometimes (1 run in 10 under a
  12-way load, measured in review), which is exactly why the pause and not a
  re-run is the gate. A flake that only appears
  under load cannot be chased by re-running the suite. Pin the split with a
  pause that certainly outlives the small budget — `outlasting(BUDGET)`, twice
  the constant. **The pause does not simulate load**: 40ms is nothing to a busy
  box. What it does is make the wrong budget fail deterministically, which is
  also what keeps the guard mutation-detectable. Derive it from the constant:
  #98 first wrote the two as separate numbers and, with the budget raised to 50,
  the guard's own mutation went 13/13 green with no signal at all.
  **For a NEW test, or a file that arms no other real budget, fake timers are
  the default** — `vi.useFakeTimers({ shouldAdvanceTime: true })`, as in
  `content/useSections.test.tsx` — and none of the juggling above is needed.
  Keep real timers only when the file already has real-budget tests you are not
  converting in this WP (worked case #98, whose two neighbours arm 30ms budgets).
- **When a call arms its own rejection on a timer, the promise it returns is
  given its handler before the next `await`.** That is the trigger, and it is
  narrow: a promise that can only reject because the test itself emits something
  is not this shape, so this is not a licence to rewrite every assertion. When a
  budget is armed _inside_ the call, the rejection can land while the test is
  parked on a `waitFor` with nobody listening; vitest then exits 1 with every
  test counted as passed, and names the cause only in its `Unhandled Errors`
  block and an `Errors 1 error` line — a red run whose pass counts read green.
  Capture `const rejected = expect(p).rejects.toThrow(...)` on the line after
  the call and `await rejected` at the end. Prove it the same way as any fix:
  move the handler back after the gap and the run must exit 1. Worked case
  (#98): two tests in `runtime/useRuntime.test.ts` had this window, both older
  than the WP that found it; a third was aligned prophylactically, its budget
  being armed 10s wide and unable to fire inside the gap.
- **A negative test about a KEY needs a positive twin.** When a test asserts
  that something stored under a computed key is _ignored_ — a draft, a cache
  entry, a query param — it passes identically when the guard works and when the
  test simply computed the wrong key and planted nothing the code would ever
  read. Pair it with a test that plants under the SAME key and expects it to be
  honoured; the pair is the proof. Worked case (#85): "a listing ignores a
  stored draft" is trustworthy only because "an editor still restores one"
  plants the identical key and gets it back.
- **A test for a state-derived NAME asserts the round trip**, not one crossing.
  "A becomes B" passes identically over code that derives the value and over
  code that latches on the first transition, so one crossing proves nothing
  about the second. Worked case (#106): the deck's fullscreen `aria-label`,
  where a latched implementation stayed green across all 569 tests and the
  return assertion is what killed it.
- **Nothing — a fix or a guard — is done before its test has been seen to fail,
  at the assertion that encodes it.** Revert the fix (or introduce the defect the
  guard names), watch the test go red, restore it — and name the failing test,
  and the line, in the commit message. A suite that reddens proves nothing about
  WHICH line reddened: an assertion sitting after a `waitFor` whose condition the
  same mutation also breaks can never fire. Worked case (#85): a guard against an
  exercise rendering its authoring banner sat behind
  `await waitFor(… toContain('Escribe'))`, and the banner _replaces_ the
  statement — so the mutation reddened the file at the wait, and the guard was
  dead through two rounds of review before a recheck named the line. Do this on a
  **committed** tree and restore with `git checkout --`: that command reverts
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
  restore it to normal state first") _after_ the metrics override has already
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
- **An invariant about what an author DECLARED reads the source.** Every layer
  that hands you a model has already normalised the distinction away — that is
  what a normaliser is for — so asking one of them what the author wrote returns
  what the author _meant after defaults_. Worked case (#108): `presentation` is
  optional and defaults to `auto`, and the invariant is that every document
  declares it. Three seams were candidates and two are structurally blind — the
  registry and the `?frontmatter` virtual module both run `parseDocumentMeta`,
  which applies the default. The third, an `import.meta.glob` with
  `query: '?raw'`, is worse than blind: the MDX plugin claims the file first, so
  the glob returns the compiled `MDXContent` function and a frontmatter regex
  over it fails EVERY case with "no frontmatter block" — indistinguishable from
  the invariant working. Read the file. Take the file _list_ from the same glob
  the app ships from, so the set checked is the set published: a directory walk
  of your own drifts from it in both directions, following a symlinked directory
  out of the tree while dropping a symlinked `.mdx` the registry does publish.
- **A fixture picked positionally silently follows the content.** `ids[0]`, "the
  first `explicit` document", "the first presentable one" — all read as robust
  and all mean "whatever the index happens to put first". Name the fixture
  whenever the assertions know its content, and give the guard a message saying
  what to repoint. Worked case (#108): declaring `explicit` on a document earlier
  in the index moved `documentSections.test.tsx` onto one whose `h2`s all come
  from `<Slide title>`, so the case asserting that BOTH heading sources produce
  one section list stopped exercising the mixed document it was written for. The
  suite stayed green at 576 while the case stopped testing what it is named for,
  and the diff that caused it touched neither that file nor either document it
  selects.
- **The guard asserts the PROPERTY, not just the name.** "This document still
  exists and still declares `explicit`" is not what makes it usable: the case
  needs whatever made it the fixture. Where the rendered DOM cannot tell the
  difference — a `<Slide title>` h2 and a markdown `##` produce identical
  headings — the guard reads the source, taking the file list from the same glob
  the app ships from (the arithmetic lives in `content/architecture.test.ts` and,
  since #135, in `app/documentSections.test.tsx`). Worked case (#135): that file
  was repointed at `java-tipos-y-flujo` BECAUSE it carries both heading sources,
  and its guard asserted neither — demoting both markdown `##` to `###` left the
  equivalence untested and four cases green.
- **A repointed fixture is a new test.** A case mutation-proven against document
  A proves nothing against document B: the new document may satisfy the assertion
  for reasons the case never claimed. When you repoint, mutate the NEW fixture —
  add the `##`, empty the `alt`, move the closing prose inside the last `<Slide>`
  — and watch the case go red before committing, then name the mutation in the
  commit message. This extends the rule above ("nothing is done before its test
  has been seen to fail") to a change that is neither a fix nor a guard, which is
  why it needs saying: the suite is already green, so nothing prompts you. Worked
  case (#135): two repointed cases stayed green under the very defect they exist
  to catch, and one of them had been unable to fail at all.
- **A fixture is resolved from the registry, not the index — unless the case is
  about navigation.** The index decides the teaching path, never existence
  (ADR-0015 §6, over the content model of ADR-0002): `/d/<id>` serves any
  compiled document, listed or not. So a case
  whose subject is _rendering_ selects through `registry.get(id)`, and only a
  case whose subject IS the path — the TOC, prev/next, the breadcrumb position —
  goes through `walkIndex`. Worked case (#136): taking one unit off the teaching
  path reddened seven cases across three files — six of them, in two files, about
  documents nobody had touched, because they were finding their fixture by
  walking the index. (The seventh was the index assertion itself, and was the
  point.) The guard message
  should say so too — "left the index" is the wrong diagnosis when what the case
  reads is the registry.
- **A whole-set invariant is weakened with a named exception list, never
  deleted.** When a legitimate change falsifies "this set is empty", the reflex
  is to drop the assertion — and that drops the alarm for every ILLEGITIMATE
  member too, silently, because the suite goes green either way. Name the
  exceptions in a constant, assert the set equals it, and give the message both
  directions: what to do when a member is missing, and what to do when one is
  there that should not be. Worked case (#136): `RETIRED` in
  `documentBreadcrumb.test.tsx`. Before it, `toEqual([])` was the only
  registry→index check in the suite, and the first change to retire a document
  on purpose would have taken it away — a document forgotten out of `index.yaml`
  would then ship green and unreachable in navigation.

  #135 emptied that list — the retired documents were deleted and the last one
  rejoined the teaching path — which returned the assertion to the plain
  `toEqual([])` it had before #136. The ALLOWLIST is what an exception costs;
  the assertion itself is free and outlives every exception. Retiring it along
  with an exception is the error to avoid: #135 nearly did, and two review
  lenses caught it independently. A companion case that rendered an unlisted
  document WAS retired there, because it needed a real document kept off the
  index to serve it — that is the fixture cost ADR-0025 §Decision forbids paying
  ("content is not invented, kept off the teaching path, or given syntax it does
  not want in order to feed a case"). Weakening and retiring are the two moves
  that rule leaves open; deleting the assertion is not one of them.

- **A rendered STATE is located by a semantic `data-*` attribute, never by its
  classes.** Matching Tailwind ties the guard to the styling, so a restyle turns
  it green while the state still ships — and the classes of an error box are the
  most likely thing to change about it. Worked case (#120 review):
  `data-authoring-error` on `AuthoringError`, which is what lets
  `app/contentRenders.test.tsx` assert that no published document paints one.
- **A class-name assertion is an exact token, never a substring.** Every Tailwind
  utility has a variant form (`hover:x`) and an alpha form (`x/10`) that CONTAIN
  the base token, so `toContain('text-accent')` passes over `hover:text-accent` —
  a link that only looks like a link once the pointer is on it — and
  `toContain('text-ink-faint')` passes over `text-ink-faint/10`, which compiles
  to a real `color-mix` at 10% and is invisible. Both were the exact defect the
  assertion existed to forbid, both shipped green, and no stylesheet-level test
  can catch either because the damage is done at the call site. Split first:
  `expect(el.className.split(/\s+/)).toContain('text-accent')`. Worked cases in
  `app/catalogRoute.test.tsx` and `content/mdxHeading.test.tsx` (#109 review).
- **A test that derives its subject by parsing a file asserts the parse found
  something**, in the same describe, with a message naming the selector or path
  that drifted. A regex over a source file returns an empty set when the source
  moves, and an empty set makes every case built on it pass while checking
  nothing. Worked case: `styles/palette.test.ts` reads token blocks out of
  `index.css`; renaming a selector turns fourteen silent passes into one named
  failure only because the guard is there (#109).
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
- **When the population legitimately reaches zero, the floor cannot survive — the
  assertion under it can.** A non-vacuity guard demands at least one member, so
  the day a real change empties the set it fires correctly and offers two wrong
  answers: delete the block, which drops the alarm for every future member
  silently, or invent content to feed it, which ADR-0025 §Decision refuses. The
  right answer is to drop the FLOOR and assert the OFFENDING set is empty — it
  passes at zero and arms itself at one, with no fixture. Worked case (#135):
  `content/architecture.test.ts` required every markdown image to carry `alt`,
  and deleting the last document that used `![](…)` emptied it. The block was
  first deleted outright, on the reasoning that the surviving file-existence gate
  covered it — it does not, it checks the path and never the alt — and two review
  lenses caught the hole by writing `![](./costo-busqueda.svg)` into a real
  document and watching the suite stay green.
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
  _somewhere_ rather than in the place that had to carry it — and the slice that
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
