# Guide — Add a content component

How to add a component that documents can use (`<Slide>`-class). Registered in
`docs/standards/integration-guides.md`; born with WP4 (#65). The **living
source of the rules is the catalog itself**: rendered at `/catalog/governance`
(`npm run dev`), authored in `apps/web/src/catalog/GovernancePage.tsx` — read
that file when working headless. ADR-0010 records why the contract exists and
ADR-0014 how the catalog implements it; this guide maps the rules onto repo
paths.

## When to use

A real class needs a component that doesn't exist (inventory is emergent, D29):
a semantic wrapper, a visualizer, a media embed, a structural block.

## Worked example

`Slide` and `SectionBreak` (family *estructura*) are the reference
implementations: component + colocated entry + seam export + MDX registration
+ per-mode tests.

```
apps/web/src/components/structure/
├── Slide.tsx              # the component (ADR-0010 contract)
├── Slide.test.tsx         # per-mode behavior tests
├── Slide.catalog.tsx      # its catalog entry (CatalogEntry from lib/)
└── ...                    # SectionBreak.* — same shape
```

## Step-by-step

1. **Pick the family** — Estructura, Semánticos, Interactivos, Media (see
   `/catalog` for definitions; these are display names — the ids used in code
   and URLs are their unaccented forms). A new family is a governance change (see
   `/catalog/governance` → Changing these rules).
   **Family ids are unaccented Spanish (they double as route segments); their
   folders are English.** The authoritative mapping is
   `apps/web/src/catalog/families.ts`, rendered on `/catalog/governance` and on
   each family page — read it there rather than from this guide.
2. **Implement** in `apps/web/src/components/<folder>/<Name>.tsx`, satisfying
   the seven contract points (`/catalog/governance` → Component contract). If
   the component reacts to the render mode, read it with `useMode()`
   (presentation seam); if a parser must recognize it, declare metadata with
   `withMeta` (`lib/componentMeta.ts`) — never expect identity imports.
3. **Register it** in the shell MDX map (`apps/web/src/app/mdxComponents.ts`).
   Not optional: the catalog and the MDX map must be the same set, asserted in
   both directions. A component that must NOT be document-facing therefore does
   not get a catalog entry either — it is not a content component (ADR-0014).
4. **Write the catalog entry**: `<Name>.catalog.tsx` beside the component,
   typed as `CatalogEntry` (`lib/catalogEntry.ts`), with description,
   when-to-use, full props table, and ≥2 live examples (both modes when
   behavior differs). Export it from the components seam
   (`apps/web/src/components/index.ts` → `catalogEntries`) — an entry that never
   reaches that array is invisible to the catalog.
   `name` is the component's identity in three places at once: it MUST equal the
   component file's basename, the MDX map key, and the `/catalog/c/:name`
   segment. Components live DIRECTLY in the family folder (the invariant test
   globs one level deep).
5. **Test**: per-mode behavior + the component's own logic. Two L4 invariant
   tests gate the entry: `src/catalog/architecture.test.tsx` fails if the entry
   is hollow (empty description or when-to-use, a prop missing type or
   description, fewer than two examples, two examples sharing a title, an
   example that renders nothing, or a name/family pair that does not resolve to
   `src/components/<folder>/<name>.tsx`); `src/app/mdxComponents.test.ts` fails
   if the MDX map and the catalog drift apart in either direction — that is also
   what catches a forgotten seam export.
6. **Verify**: per-commit protocol green; review the PR against the review
   checklist (`/catalog/governance`).

### Heavy components register through a lazy wrapper

The shell builds `mdxComponents` and `catalogEntries` eagerly, so **any** static
import of a component from a module the shell reaches puts that component — and
everything it imports — in the entry chunk, paid by every reader of every page.
`CodeEditor` brings CodeMirror: registering it directly took the entry chunk from
478kB to 891kB.

When a component carries a heavy dependency, add a `lazy<Name>.tsx` beside it
that wraps `lazy()` in a `Suspense` with a sized placeholder, export **that**
through the seam, and register it in the MDX map. Its catalog entry must import
the wrapper too — the entry is reachable from the shell, so a static import
there undoes the split just as effectively. Worked case:
`components/interactive/lazyCodeEditor.tsx`, guarded by an L4 case in
`src/architecture.test.ts`.

## Checklist

- [ ] Family chosen; seven contract points satisfied.
- [ ] Registered in `app/mdxComponents.ts` (mandatory for every catalogued component).
- [ ] Colocated `.catalog.tsx` entry exported via the components seam.
- [ ] ≥2 live examples; per-mode tests; completeness test green.
- [ ] If it carries a heavy dependency: lazy wrapper registered instead of the
      component, catalog entry importing the wrapper, entry chunk unchanged in
      `npm run build`.
- [ ] PR reviewed against the catalog's review checklist.
