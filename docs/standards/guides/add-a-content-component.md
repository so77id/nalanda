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

`Slide` and `SectionBreak` (family *structure*) are the reference
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

1. **Pick the family** — Structure, Semantic, Interactive, Media (see `/catalog`
   for definitions). A new family is a governance change (see
   `/catalog/governance` → Changing these rules).
   **A family's id is one word doing three jobs**: the route segment, the
   `src/components/` folder, and the display name lowercased (#87). There is no
   mapping to look up. The taxonomy itself lives in
   `apps/web/src/catalog/families.ts` and is rendered on `/catalog/governance`
   and on each family page — read it there rather than from this guide.
   Two of the four families are empty, and deliberately so: a component is built
   when a class needs one. Picking an empty family is normal; creating its folder
   is part of adding the first component to it.
2. **Implement** in `apps/web/src/components/<family id>/<Name>.tsx`, satisfying
   the contract points (`/catalog/governance` → Component contract). If
   the component reacts to the render mode, read it with `useMode()`
   (presentation seam); if a parser must recognize it, declare metadata with
   `withMeta` (`lib/componentMeta.ts`) — never expect identity imports.

   Four seams worth knowing before writing your own:

   - **Labelled code fences.** A component whose children carry code the author
     marks — ```` ```java starter ```` — reads them with `fencesByMeta` /
     `withoutFences` (`lib/codeFences.ts`); the `remarkCodeMeta` plugin has
     already preserved the label as `data-meta`. Code arrives as children, never
     through a prop (ADR-0019 §1–2). Worked case: `<Exercise>`.
   - **Telling the author they got it wrong.** When a component has a contract
     only visible after MDX evaluation — a missing fence, the wrong number of
     children — render `<AuthoringError component="Name">` and say what is
     missing. Render, never throw, and address the *writer*: the reader cannot
     fix it. The stricter sibling is `content/contentIntegrity.ts`, which fails
     the build instead — use it when the mistake is detectable without rendering
     (frontmatter, the index). Worked cases: `<Exercise>`, `<SideBySide>`.
   - **The measure.** The book view narrows *running text* to 39rem inside a
     768px column (`.measured-prose`, `styles/index.css`, ADR-0022). Every
     direct child of the article is narrowed unless it is a bare `pre`, marks
     itself **`.not-prose`** (a block, not text — `CodeEditor`, `Exercise`,
     `SideBySide`, `AuthoringError` all do) or **`.measure-full`** (neither
     block nor text: the table scroll box, the prev/next row, `<SectionBreak/>`).
     **Anything the reader drags sideways must be a REAL scroller.** In
     presentation the deck owns the horizontal swipe and yields only to a
     descendant whose computed `overflow-x` is `auto` or `scroll` AND that
     actually overflows (`presentation/swipe.ts`, ADR-0013 §5.2). A component
     that pans by transform, by canvas pointer handling, or inside an
     `overflow-x: visible` wrapper will have that drag taken as a slide change
     on a phone; conversely a full-bleed scrollable component leaves the reader
     no swipe target on that slide. Give it `overflow-x-auto`, and check it on
     a touch context.

     **A component that renders anything wide MUST carry one of the two**, or it
     is silently centred at 624px in documents. The rule is unlayered, so a
     `max-w-*` of your own cannot override it. It will look correct everywhere
     you are likely to check — `/catalog` and presentation mode do not apply the
     measure, and jsdom computes no layout — so verify it in the book view of a
     real document.
   - **Inside `interactive/`**, reuse `Panel` (a labelled output strip),
     `useRunShortcut` (Ctrl/Cmd + Enter) and `draft.ts` — whose `saveDraft` must
     be called immediately *before* a run, never after, because a Java loop that
     never ends is the case it exists for (ADR-0020 §2).
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
   `src/components/<family id>/<name>.tsx`); `src/app/mdxComponents.test.ts` fails
   if the MDX map and the catalog drift apart in either direction — that is also
   what catches a forgotten seam export.
6. **Verify**: per-commit protocol green; review the PR against the review
   checklist (`/catalog/governance`).

### Heavy components register through a lazy wrapper

The shell builds `mdxComponents` and `catalogEntries` eagerly, so **any** static
import of a component from a module the shell reaches puts that component — and
everything it imports — in the entry chunk, paid by every reader of every page.
`CodeEditor` brings CodeMirror: registering it directly roughly doubled the
entry chunk (measured in ADR-0018 §7).

When a component carries a heavy dependency, add a `lazy<Name>.tsx` beside it
that wraps `lazy()` in a `Suspense` with a sized placeholder, export **that**
through the seam, and register it in the MDX map. Its catalog entry must import
the wrapper too — the entry is reachable from the shell, so a static import
there undoes the split just as effectively. Worked case:
`components/interactive/lazyCodeEditor.tsx`, guarded by an L4 case in
`src/architecture.test.ts`. **That guard is per-component, not generic**: copy
its "stays out of the entry chunk" describe block for your component, with your
own wrapper in `ALLOWED`, or nothing checks you.

## Checklist

- [ ] Family chosen; the contract points satisfied — including the `h2` one if
      the component marks a section, and the measure one if it renders wide.
- [ ] **If the family was empty before this PR**: you created its folder, and you
      moved the one hardcoded empty-family case in `app/catalogRoute.test.tsx`
      (it names `/catalog/media` today and fails with instructions when media
      stops being empty) to a family that is still empty — the other empty-family
      tests find the empty family themselves and need nothing. Keep the
      rendered-English `it.each` list covering one populated and one still-empty
      family page.
- [ ] Registered in `app/mdxComponents.ts` (mandatory for every catalogued component).
- [ ] Colocated `.catalog.tsx` entry exported via the components seam.
- [ ] ≥2 live examples; per-mode tests; completeness test green.
- [ ] Wide output carries `.not-prose` or `.measure-full`, checked in the book
      view of a real document (`npm run build && npm run preview`), not only in
      `/catalog` — which does not apply the reading measure.
- [ ] If it carries a heavy dependency: lazy wrapper registered instead of the
      component, catalog entry importing the wrapper, its own L4 case copied in
      `src/architecture.test.ts`, entry chunk unchanged in `npm run build`.
- [ ] PR reviewed against the catalog's review checklist.
