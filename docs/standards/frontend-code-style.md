# Frontend Code Style — `apps/web`

Bounded TypeScript/React style for the Nalanda frontend. **Agents follow this
document; they do not innovate on style.** When a real case has no rule here,
propose one in the PR and record it in this document in the same PR (growth rule,
as in `repository-structure.md`).

Enforced mechanically by: `oxlint` (correctness + React/hooks rules), `prettier`
(formatting — never argue with it), `tsc -b` (types, strict mode). All three must
pass before every commit.

## Language & compiler

- TypeScript everywhere; `strict` stays on. No `any` unless interfacing with an
  untyped boundary — and then wrapped immediately in a typed function.
- All identifiers, comments, and file names in English (repo-wide rule).

## Folder layout (`src/`)

```
src/
├── app/            # shell: entry (main.tsx), router (App.tsx), providers, global layout,
│                   # and the shell's own build plugin (spaFallback.ts)
├── components/     # catalog content components, by family:
│   ├── structure/  ├── semantic/  ├── interactive/  └── media/
│                   # the family id IS the folder name (#87). semantic/ and media/
│                   # do not exist yet: an empty family has no folder, and the
│                   # first component added to one creates it.
│                   # plus shared, non-document-facing components at the root
├── catalog/        # /catalog feature: registry, catalog pages
├── content/        # content pipeline AND the book-reading surface: registry, loader,
│                   # remark plugins, the document page and its shell (index tree,
│                   # breadcrumb, section spine + rail/drawer). The per-folder
│                   # inventory is apps/web/README.md's job; this is responsibility.
├── presentation/   # presentation mode: parser, viewer, mode context
├── runtime/        # code execution: worker contract, per-language runtimes, useRuntime
├── lib/            # pure TS utilities — imports nothing from the folders above
└── styles/         # global CSS: Tailwind entry + design tokens (@theme)
```

- **Feature-first**: each feature folder owns its components, hooks, helpers, and
  tests (colocated `*.test.ts` / `*.test.tsx`).
- **No generic `utils/`** dumping ground. A helper belongs to its feature; only
  pure, feature-agnostic code goes to `lib/`.
- **Import direction**: `app → features → lib`. Features may import from other
  features only through deliberate public seams (their root export); `lib` imports
  from no feature; no cycles ever. (Enforced by `src/architecture.test.ts` —
  pattern imported from DocumentBuddy's architecture tests.)
- **Cross-feature dependencies are an explicit allowlist**, mirrored by
  `FEATURE_EDGES` in `src/architecture.test.ts`. Current edges:
  `components → presentation` (mode awareness via `useMode`; `ModeProvider` to
  stage per-mode catalog examples),
  `components → runtime` (`CodeEditor` loads a language runtime and drives it
  through `useRuntime`; the runtime feature knows nothing about components, so
  the edge stays one-way),
  `presentation → content` (registry + lazy document access), and
  `catalog → components` (renders the entries and live examples the components
  feature exports through its seam). Adding an edge is
  an architectural decision: extend the map AND record the new edge + rationale
  here in the same PR. Test files may cross any feature through its seam (they
  are consumers, like the shell); production code follows the allowlist.
- **Cross-feature contract types live in `lib/`** (e.g. `lib/catalogEntry.ts`,
  `lib/componentMeta.ts`) so the producing feature never imports the consuming
  one. Worked case: a component's colocated catalog entry types itself from
  `lib/` — importing the catalog feature would close a cycle.
- **Cross-feature element identity travels as static metadata**, never as
  component-identity imports: declare with `withMeta` and inspect with `metaOf`
  (`lib/componentMeta.ts`). Worked case: the slide parser recognizes
  `slideBoundary`/`headingLevel` without importing `Slide` or the heading
  factory — which would close a feature cycle.
- **Fence metadata reaches a component through `lib/`, not through `content/`**:
  a remark plugin in `content/` writes it onto the element (`content/codeMeta.ts`
  → `data-meta`) and the reader lives in `lib/codeFences.ts`, because
  `components → content` is not an allowed edge. Worked case: `<Exercise>` tells
  its `starter` fence from its `test` fence (ADR-0019 §1–2). Same shape as the
  two rules above — the producing feature never learns who consumes it.
- **MDX component maps are shell-composed**: features export partial maps
  (e.g., `content/mdxComponents.ts`), and `app/mdxComponents.ts` merges them
  into the provider around the routes. Features never assemble the global map;
  documents use registered components without imports (ADR-0003/0010).
  **An element renderer that needs a component registers in the SHELL's map**,
  not in the feature's: `content → components` is not an allowed edge, so a
  mapping that reaches for one goes where the map is composed (worked case:
  `pre → MdxPre`, #85). It needs no catalog entry — the completeness invariant
  covers capitalised keys only, because an intrinsic override is not a name an
  author writes (`a`, `table`, `h2`, `h3`, `h4` are the precedent; ADR-0024 decides it for the fence).
- **Map the wrapper, never the fence.** `pre` is mapped and `code` is not, and
  the difference is not stylistic: `lib/codeFences.ts` identifies an exercise's
  `starter` and `test` fences by the literal `code` intrinsic type, so a
  component in that position leaves every `<Exercise>` unable to find its own
  body — silently, with a green suite. Enforced by
  `app/documentFences.test.tsx`, whose failure message says so.
- **Route-level pages**: shell-owned pages (e.g., `NotFound`) live in `app/`;
  feature pages live in their feature folder.
- **Shell UI reaches features by injection**: when a feature needs shell-owned
  UI (error pages, layout slots), the shell passes it via props/children —
  features never import from `app/`. Worked case: `AppRoutes` injects
  `<NotFound />` into `DocumentPage`'s `notFound` prop.
- **Not everything under `components/` is a catalog component.** Two shapes have
  no catalog entry and no MDX registration, and neither is an omission
  (a third, the intrinsic-element renderer above, has no entry but _is_
  registered — in the shell's map):
  a component **shared across families** lives at the root of `components/`
  (worked case: `AuthoringError.tsx`, used by `interactive/Exercise` and
  `structure/SideBySide`), and a helper **private to one family** lives in that
  family's folder (worked cases: `interactive/Panel.tsx`,
  `interactive/useRunShortcut.ts`). The catalog invariant tolerates both because
  it iterates registered entries, not files — which also means neither shape is
  guarded: if it should be documented, register it.
- **Build-time plugins live with the concern they serve**, not in a separate
  tooling folder: `content/contentIntegrity.ts` (Vite plugin) gates content,
  `content/wikiLinks.ts` (remark plugin) transforms it, `content/codeMeta.ts`
  (remark plugin) preserves fence metadata, `app/spaFallback.ts`
  (Vite plugin) serves the shell's router. They are Node-only, never imported by
  browser code, and wired exclusively from `vite.config.ts` — a
  confirmation-gated file (see `apps/web/CLAUDE.md`): propose the wiring diff and
  get confirmation before editing it. The remark list itself lives in
  `content/mdxPlugins.ts` so the suite can compile MDX through the same array the
  build uses; its order is an invariant — syntax extensions (`remark-gfm`) before
  the plugins that walk the tree parsing produced.
- **The shell titles the document, and owns anything else that is a property of
  the page rather than of a feature.** A render-nothing component in `app/` with
  an effect is the shape for it (worked case: `app/DocumentTitle.tsx`). It cannot
  live in a feature — features may not import `app/`, and only the shell may
  import every feature — and it must not live in `lib/`, which is for pure code
  (the rule that moved `draft.ts` out of it in #76).
- **The global stylesheet may name a third-party class only when nothing else
  can win**, and the rule says why in place. Worked case: `.cm-editor.cm-focused`
  in `styles/index.css`. CodeMirror injects `outline: none` **unlayered**, and
  Tailwind v4 emits its utilities inside `@layer utilities` — unlayered beats
  layered regardless of specificity, so a `focus-within:` utility on the
  component loses. The same rule cuts the other way and is worth knowing before
  writing anything here: an unlayered declaration in this file overrides every
  Tailwind utility on the page, which is how a `border-radius` in `:focus-visible`
  silently reshaped every focused button (#83).
- **The deployment base path is declared once**, in `vite.config.ts` (`outDir`
  stays at the Vite default); runtime code derives from `import.meta.env.BASE_URL`
  and CI never overrides it on the command line — a CI-only flag makes local
  builds unreproducible (ADR-0015).
- Directories are created when their first real file arrives — never empty.

## Naming

- Component files: `PascalCase.tsx`, named after the component (`NotFound.tsx`).
- Colocated catalog entries: `<Component>.catalog.tsx` beside the component,
  exporting `<component>CatalogEntry: CatalogEntry` — a `.tsx` module that
  exports data, not a component (its examples are JSX). Full walkthrough:
  `docs/standards/guides/add-a-content-component.md`.
- Lazy wrappers: `lazy<Name>.tsx` beside the component, exporting `Lazy<Name>` —
  deliberately lower-camel so the wrapper never reads as the component itself at
  an import site. Required for any component carrying a heavy dependency
  (`guides/add-a-content-component.md` §Heavy components, ADR-0018 §7); worked
  case `components/interactive/lazyCodeEditor.tsx`.
- Hooks: `useThing.ts`, exported as `useThing`.
- Everything else: `camelCase.ts` (`parser.ts`, `wikiLinks.ts`).
- One exported component per file; small private subcomponents may live beside it
  in the same file if they are not reused elsewhere.

## Components

- Functional components only, declared as `export function Name(...)`. **No default
  exports** (imports stay grep-able and rename-safe).
- Props: `interface`/`type` named `Props` (or `NameProps` when exported), declared
  above the component in the same file.
- Hooks at top level only (Rules of Hooks); derive state instead of syncing it.
- Keep components one-concern; extract shared logic into hooks, shared markup into
  components — but only at the second real use, not speculatively. **One
  exception**: a pure helper may be extracted at its FIRST use when the real data
  cannot exercise all its branches. The extraction exists to make the unreachable
  case testable, not to anticipate reuse, and it belongs to its feature — not
  `lib/` — unless it is feature-agnostic. Worked case (#87):
  `catalog/componentCount.ts`, because no family holds exactly one component, so
  `1 component` would ship unproven if the logic stayed inline.
- Fail fast at boundaries with clear messages: prefer explicit checks with
  descriptive errors over `!` non-null assertions at DOM/external boundaries
  (see `app/main.tsx` root check); user-facing failures render friendly UI,
  never a blank screen.

## Styling

- **Tailwind only**, utility classes inline in JSX. No CSS modules, no CSS-in-JS,
  no new `.css` files beyond `styles/` globals.
- Design tokens (colors, spacing, fonts beyond Tailwind defaults) are declared in
  `styles/index.css` via Tailwind v4 `@theme` — components never hardcode hex
  values or magic pixel sizes.
- `style={{ ... }}` only for genuinely dynamic values (computed positions,
  and a measured transform — see the fit-to-stage rule below).
- **Content that must not reflow is laid out at its design size and scaled**,
  never re-typeset per screen. The scale is computed by a pure, unit-tested
  helper rather than inline in the component, because jsdom lays nothing out
  and the arithmetic is the only half a suite can judge. Two invariants make it
  work: measure with `offsetWidth`/`offsetHeight`, which ignore the transform
  about to be applied, so a re-measure sees the natural size instead of
  compounding; and observe BOTH boxes, because a font finishing loading changes
  the content without changing the stage. Cap the scale at 1 — a big screen
  shows design size, not a blown-up slide. And **hold the measured nodes in
  state via callback refs, so the effect can depend on their identity**: keyed
  on an index instead, it does not re-run when the same index gets a new node —
  which is what `AnimatePresence mode="wait"` does on every slide change, and
  what an early return does when the deck replaces another view. Worked case:
  `presentation/fit.ts` + `SlideDeck` (#99, where both defects shipped past a
  green suite and a thirty-point browser pass); the decision and its
  consequences are ADR-0013 §5.1.
- **A full-viewport overlay carries `h-[100dvh]` beside `fixed inset-0`.**
  `inset-0` resolves against the LARGE viewport — the one a mobile browser
  overlays with its own chrome — so the overlay draws under the URL bar. The
  page-level half is `viewport-fit=cover`, declared once in `index.html`, which
  is therefore load-bearing for this rule despite sitting outside `src/`.
  Worked case: `SlideDeck` and `RotateNotice` (#99), a failure invisible to the
  suite and to any desktop browser. Note the version floor in
  `apps/web/README.md`: `dvh` degrades silently below it rather than throwing.

- **The reading measure is a global rule, and components opt out of it by name**
  (ADR-0022). The document `<article>` carries `.measured-prose`, and in
  `styles/index.css` every DIRECT child of it is capped at 39rem and centred
  unless it is a bare `pre`, marks itself `.not-prose` (a block, not text —
  `CodeEditor`, `Exercise`, `SideBySide`, `AuthoringError`), or marks itself
  `.measure-full` (neither block nor text: the scroll box around a table, the
  prev/next row, the `<SectionBreak/>` rule). **A component that renders
  anything wide MUST carry one of the two.** The rule is unlayered on purpose,
  so a child's own `max-w-*` or `w-full` cannot win — the opt-out is the marker
  class, deliberately, and this also binds new element renderers registered in
  `content/mdxComponents.ts` (worked case: `MdxTable`), not only catalog
  components. Nothing enforces it: the failure is a silently centred 624px
  block, invisible to jsdom and invisible in `/catalog`, which does not apply
  the measure. Verify wide output in the book view of a real document.
- **A shared overlay declares no breakpoint; the page owns the width policy**,
  in one place. Worked case: `content/Drawer.tsx` carried `md:hidden` while the
  rail it complements appears at `2xl`, so the two owners disagreed and
  768–1535px got neither navigation — with both code comments claiming
  otherwise (#84).

## Animation

- **framer-motion is the only animation library** (ADR-0004). CSS transitions are
  fine for trivial hover/focus states; anything choreographed uses framer-motion.

## Icons

- **lucide-react is the only icon library.** Icons are used inline with an
  explicit `size`, never as background images. 13–14px beside a label, matching
  the surrounding text (`Ejecutar`, `Copiar`, `Comprobar`), and also for an
  icon-only control inside a component's own dense chrome (`CodeEditor`'s
  expand). 16px for an icon-only control on the PAGE chrome, where the button is
  a touch target rather than part of a text row — the drawer toggle and its
  close button (#84) and the deck's exit control (#103). **The floor is 24x24
  CSS px with at least 8px of clearance** (WCAG 2.2 §2.5.8, level AA); `p-2`
  around a 16px icon gives 32x32 and is the shape to copy. 44x44 — the
  Apple/Material figure and WCAG's AAA target — was considered and rejected for
  deck chrome, which would then dominate a 342px-tall landscape stage. Measured
  case that forced the floor (#103): at `px-2 py-1` the deck's exit was 32x24
  with 4px of clearance from a control that does the opposite thing, so a
  mis-tap took the reader deeper in instead of out. All three obey it since
  #106 — measured on a phone profile at 34x34, 32x32 and 32x32, each with at
  least 12px of clearance from its neighbour (`gap-3`, `gap-4`, `mb-3`), which
  is the half the retired debt note had named. A control the platform cannot honour is
  not shown at all: where `requestFullscreen` is absent — every browser on iOS —
  the deck omits its `⛶` rather than painting a button that answers nothing
  (#111). The check is a capability, never a device. 48px when the icon is the illustration of
  a full-screen panel rather than a control — it carries the message at a
  glance, is `aria-hidden` because the text beside it says the same thing, and
  is not clickable (worked case: `presentation/RotateNotice.tsx`, #91). Adding a
  second icon set needs the same discussion a dependency does (root `CLAUDE.md`).

## State

- Local `useState`/`useReducer` first; React context for genuinely cross-cutting
  concerns. No global state library — introducing one requires an ADR.
- **A browser store is subscribed with `useSyncExternalStore`, not `useState` +
  an effect.** A `MediaQueryList`, `document.fullscreenElement`, a storage
  event: React re-reads the snapshot after subscribing, so the gap between the
  first render and the effect closes by construction. Doing it by hand needs an
  extra re-read for that gap, and the only test that can prove the re-read
  asserts render/effect ordering — an implementation detail, which component
  tests may not assert (`apps/web/CLAUDE.md`). Worked case:
  `presentation/usePortraitPhone.ts` (#91), where the hand-rolled version
  shipped in the first slice and was replaced in review, once the review
  measured that no permitted test could kill its re-read.
- **A container-level gesture yields to descendants that scroll on its axis.**
  Decide eligibility at `touchstart` by walking from `event.target` to
  `event.currentTarget`, and refuse when a node in between really scrolls on
  the gesture's axis — `getComputedStyle(node).overflowX` of `auto` or
  `scroll`, AND `scrollWidth > clientWidth + 1` — these are integer
  pixels, so a sub-pixel overflow surfaces as a 1px difference, and a scroll of
  under a pixel is not a reader panning. Overflowing content is
  not a scrollable box: `visible` overflows and cannot pan, `hidden` clips and
  cannot pan, and treating either as a scroller kills the gesture across the
  whole surface. Worked case: `presentation/swipe.ts` + `SlideDeck` (#103) —
  a code block wider than the slide is dragged to be read, and the deck used to
  take that drag as navigation, which made a long line unreadable on a phone.
  A handler that stores a start point clears it on `touchcancel` too, or the
  next `touchend` acts on a drag the reader never finished (#99 shipped that,
  #103 fixed it). A second gesture on another axis parameterises
  `startsInsideHorizontalScroller` rather than copying it: the vertical form
  reads `overflowY` and `scrollHeight > clientHeight + 1`.
- **Leaving fullscreen is guarded, and each surface has one way to do it.**
  `document.exitFullscreen()` REJECTS when nothing is fullscreen and `void`
  attaches no catch, so an unguarded call is an unhandled rejection on every
  ordinary exit. Always `if (document.fullscreenElement) void
document.exitFullscreen?.()`, behind one named helper that the surface's other
  exits call. Worked case: `presentation/SlideDeck.tsx`'s `leaveFullscreen()`
  (#103), where three call sites had drifted into three spellings.
- **A toggle's accessible name says what pressing it will DO**, and derives
  that from the state itself rather than from what the component last did.
  `aria-label="Pantalla completa"` on a button that also leaves fullscreen
  announces the opposite of the truth half the time. Worked cases:
  `CodeEditor`'s expand control (`Expandir a pantalla completa` / `Cerrar
pantalla completa`) and the deck's `⛶` (#106). **When the state belongs to the
  browser rather than to the component**, read it through
  `useSyncExternalStore` so the name follows a change made by a key, by the
  browser's own chrome or by another rule — the deck's `⛶` alone, since
  `CodeEditor`'s expansion is its own `useState` over a CSS overlay.
- **A surface that replaces the viewport carries a visible way out.** A keyboard
  escape announces itself nowhere and a phone has no `Escape` key, so a
  full-viewport surface needs an on-screen exit, sized per §Icons, navigating to
  an ABSOLUTE route rather than `history.back()`. Worked case: the deck's footer
  exit (#103) — the `⛶` toggle alone left it with no announced way out for two
  WPs.
- **Layout breakpoints stay in Tailwind classes; a media query is only asked
  from JS when device shape decides BEHAVIOUR** — what gets rendered at all,
  not how wide it is. It belongs in a hook colocated in the feature that owns
  the behaviour (`presentation/usePortraitPhone.ts`), never in a shared
  `lib/useMediaQuery`, and the call is guarded with `typeof window.matchMedia`
  so the suite gets `false` instead of a throw.
- Two contexts exist and both state a **situation**, never a command: `useMode`
  (this is being presented) and `useEmbedded` (something already framed and
  labelled you — `components/embedded.ts`, #85). The container declares the
  situation; each component decides what to do about it. Reach for a context
  when the consumer is authored as markdown, because then there is no prop to
  pass and no selector that can reach inside it.

## Imports

- Order: external packages, then internal, separated by a blank line. Within a
  feature use relative imports; importing another feature goes through its root.
  **A test is a consumer like the shell and may reach a feature module
  directly** — `architecture.test.ts` exempts `*.test.*` for exactly this. Never
  widen a feature's seam so a test can reach something: #85 put
  `export { remarkPlugins }` on `content/`'s browser-facing seam for one test,
  which dragged the build-time MDX compiler and a TOML parser into the entry
  chunk — **+27,781 B on every page**, with every architecture test green
  (ADR-0018 §Consequences). Worked case: `app/documentFences.test.tsx` imports
  `content/mdxPlugins` directly, and the seam stays narrow.

## Comments & docs

- Comments state only what the code cannot: constraints, invariants, "why".
  No narration, no changelog comments. English always.
- Every exported function/component in `lib/` and feature seams gets a one-line
  JSDoc saying what it is for.

## References

- ADR-0004 (frontend stack) · ADR-0005 (dev standards) · ADR-0011 (dev toolchain + routing) · `repository-structure.md`
- `testing-strategy.md` — what to test and when (companion document).
