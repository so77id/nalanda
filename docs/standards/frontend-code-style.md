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
├── app/            # shell: entry (main.tsx), router (App.tsx), providers, global layout
├── components/     # catalog content components, by family:
│   ├── structure/  ├── semantic/  ├── interactive/  └── media/
├── catalog/        # /catalog feature: registry, catalog pages
├── content/        # content pipeline: registry, loader, wiki-links plugin
├── presentation/   # presentation mode: parser, viewer, mode context
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
  `components → presentation` (mode awareness via `useMode`),
  `presentation → content` (registry + lazy document access), and
  `catalog → components` (renders the entries and live examples the components
  feature exports through its seam). Adding an edge is
  an architectural decision: extend the map AND record the new edge + rationale
  here in the same PR. Test files may cross any feature through its seam (they
  are consumers, like the shell); production code follows the allowlist.
- **Cross-feature element identity travels as static metadata**, never as
  component-identity imports: declare with `withMeta` and inspect with `metaOf`
  (`lib/componentMeta.ts`). Worked case: the slide parser recognizes
  `slideBoundary`/`headingLevel` without importing `Slide` or the heading
  factory — which would close a feature cycle.
- **MDX component maps are shell-composed**: features export partial maps
  (e.g., `content/mdxComponents.ts`), and `app/mdxComponents.ts` merges them
  into the provider around the routes. Features never assemble the global map;
  documents use registered components without imports (ADR-0003/0010).
- **Route-level pages**: shell-owned pages (e.g., `NotFound`) live in `app/`;
  feature pages live in their feature folder.
- **Shell UI reaches features by injection**: when a feature needs shell-owned
  UI (error pages, layout slots), the shell passes it via props/children —
  features never import from `app/`. Worked case: `AppRoutes` injects
  `<NotFound />` into `DocumentPage`'s `notFound` prop.
- Directories are created when their first real file arrives — never empty.

## Naming

- Component files: `PascalCase.tsx`, named after the component (`NotFound.tsx`).
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
  components — but only at the second real use, not speculatively.
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
- `style={{ ... }}` only for genuinely dynamic values (computed positions).

## Animation

- **framer-motion is the only animation library** (ADR-0004). CSS transitions are
  fine for trivial hover/focus states; anything choreographed uses framer-motion.

## State

- Local `useState`/`useReducer` first; React context for genuinely cross-cutting
  concerns (e.g., presentation mode). No global state library — introducing one
  requires an ADR.

## Imports

- Order: external packages, then internal, separated by a blank line. Within a
  feature use relative imports; importing another feature goes through its root.

## Comments & docs

- Comments state only what the code cannot: constraints, invariants, "why".
  No narration, no changelog comments. English always.
- Every exported function/component in `lib/` and feature seams gets a one-line
  JSDoc saying what it is for.

## References

- ADR-0004 (frontend stack) · ADR-0005 (dev standards) · ADR-0011 (dev toolchain + routing) · `repository-structure.md`
- `testing-strategy.md` — what to test and when (companion document).
