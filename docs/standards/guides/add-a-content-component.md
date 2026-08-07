# Guide — Add a content component

How to add a component that documents can use (`<Slide>`-class). Registered in
`docs/standards/integration-guides.md`; born with WP4 (#65). The **living
source of the rules is the catalog itself** (`/catalog/governance`, ADR-0010) —
this guide maps those rules onto the repo.

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

1. **Pick the family** — estructura, semánticos, interactivos, media (see
   `/catalog` for definitions). A new family is a governance change (see
   `/catalog/governance` → Changing these rules).
2. **Implement** in `apps/web/src/components/<family>/<Name>.tsx`, satisfying
   the seven contract points (`/catalog/governance` → Component contract). If
   the component reacts to the render mode, read it with `useMode()`
   (presentation seam); if a parser must recognize it, declare metadata with
   `withMeta` (`lib/componentMeta.ts`) — never expect identity imports.
3. **Register it** in the shell MDX map (`apps/web/src/app/mdxComponents.ts`)
   if documents use it without imports.
4. **Write the catalog entry**: `<Name>.catalog.tsx` beside the component,
   typed as `CatalogEntry` (`lib/catalogEntry.ts`), with description,
   when-to-use, full props table, and ≥2 live examples (both modes when
   behavior differs). Export it from the components seam
   (`apps/web/src/components/index.ts` → `catalogEntries`).
5. **Test**: per-mode behavior + the component's own logic. The **completeness
   test** (`src/app/mdxComponents.test.ts`) fails the battery if a registered
   component lacks its entry.
6. **Verify**: per-commit protocol green; review the PR against the review
   checklist (`/catalog/governance`).

## Checklist

- [ ] Family chosen; seven contract points satisfied.
- [ ] Registered in `app/mdxComponents.ts` (if document-facing).
- [ ] Colocated `.catalog.tsx` entry exported via the components seam.
- [ ] ≥2 live examples; per-mode tests; completeness test green.
- [ ] PR reviewed against the catalog's review checklist.
