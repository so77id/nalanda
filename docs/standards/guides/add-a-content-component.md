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

`Slide` and `SectionBreak` (family _structure_) are the reference
implementations: component + seam export in `components/index.ts` + colocated entry + a line in
`components/catalogEntries.ts` + MDX registration

- per-mode tests.

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
   One of the four families is still empty (`semantic`, since #119 populated
   `media`), and deliberately so: a component is built when a class needs one.
   Picking an empty family is normal; creating its folder is part of adding the
   first component to it — as is moving the one hardcoded empty-family case in
   `app/catalogRoute.test.tsx`, whose failure message says where.
2. **Implement** in `apps/web/src/components/<family id>/<Name>.tsx`, satisfying
   the contract points (`/catalog/governance` → Component contract). If
   the component reacts to the render mode, read it with `useMode()`
   (presentation seam); if a parser must recognize it, declare metadata with
   `withMeta` (`lib/componentMeta.ts`) — never expect identity imports.

   Eight seams worth knowing before writing your own:

   - **Labelled code fences.** A component whose children carry code the author
     marks — ` ```java starter ` — reads them with `fencesByMeta` /
     `withoutFences` (`lib/codeFences.ts`); the `remarkCodeMeta` plugin has
     already preserved the label as `data-meta`. Code arrives as children, never
     through a prop (ADR-0019 §1–2). Worked case: `<Exercise>`.
   - **Telling the author they got it wrong.** When a component has a contract
     only visible after MDX evaluation — a missing fence, the wrong number of
     children — render `<AuthoringError component="Name">` and say what is
     missing. Render, never throw, and address the _writer_: the reader cannot
     fix it. The stricter sibling is `content/contentIntegrity.ts`, which fails
     the build instead — use it when the mistake is detectable without rendering
     (frontmatter, the index). Worked cases: `<Exercise>`, `<SideBySide>`.
   - **The measure.** The book view narrows _running text_ to 39rem inside a
     768px column (`.measured-prose`, `styles/index.css`, ADR-0022). Every
     direct child of the article is narrowed unless it is a bare `pre`, marks
     itself **`.not-prose`** (a block, not text — `CodeEditor`, `Exercise`,
     `SideBySide`, `AuthoringError`, `Figure` all do) or **`.measure-full`**
     (neither block nor text: the table scroll box, the prev/next row,
     `<SectionBreak/>`, and the two layout containers `Split` and `Mosaic`, whose
     columns hold running text that must keep its typography — `not-prose` would
     strip it from exactly the half that needs it).
     **Anything the reader drags sideways must be a REAL scroller.** In
     presentation the deck owns the horizontal swipe and yields only to a
     descendant whose computed `overflow-x` is `auto` or `scroll` AND that
     actually overflows (`presentation/swipe.ts`, ADR-0013 §5.2). A component
     that pans by transform, by canvas pointer handling, or inside an
     `overflow-x: visible` wrapper will have that drag taken as a slide change
     on a phone; conversely a full-bleed scrollable component leaves the reader
     no swipe target on that slide. Give it `overflow-x-auto`, and check it on
     a touch context.

     **One exception, and it is about ownership rather than styling**: a
     scroller that lives inside ANOTHER document — a cross-origin `<iframe>` —
     is unreachable by `swipe.ts`, which walks from the event target up to the
     stage **within this DOM**. The deck never receives the touch at all, so no
     `overflow-x-auto` is wanted and adding one would build a scroller of our
     own around the frame. Measured, not reasoned: on a phone in landscape,
     same slide and same gesture, dragging inside the frame left `?slide`
     untouched while dragging beside it moved a slide. Worked case:
     `<SheetEmbed>` (#146, ADR-0035 §Consequences).

     **A component that renders anything wide MUST carry one of the two**, or it
     is silently centred at 624px in documents. The rule is unlayered, so a
     `max-w-*` of your own cannot override it. It will look correct everywhere
     you are likely to check — `/catalog` and presentation mode do not apply the
     measure, and jsdom computes no layout — so verify it in the book view of a
     real document.

   - **Being inside something that already frames you.** A container that draws
     a border and writes a label wraps its children in
     `<EmbeddedProvider value={true}>` (`components/embedded.ts`); a component
     that draws its own chrome reads `useEmbedded()` and drops the duplicated
     frame, header and gutter. A CSS descendant selector is not a substitute:
     `[&_pre]` rules reach a bare fence and stop at a component's boundary,
     which is exactly why they stopped working the day a fence became one.
     Worked case: `<SideBySide>` × `CodeEditor` (#85, ADR-0024) — the column supplies the
     language label, so the editor suppresses its filename and its chip.
   - **Knowing something about the document around you.** A component that
     must check itself against the surrounding document reads
     `useKnownSections()` (`lib/knownSections.ts`); `DocumentPage` publishes the
     same section spine the rail and the drawer draw from. Empty means NOT
     MEASURED — the spine is read from the DOM after mount — so never treat it
     as authority. Worked case: `<Question>` verifying the `anchor` it claims
     (#139). To know whether a section is presented as a SLIDE (not merely
     rendered as an h2 — the two are the same set in `auto` mode but diverge
     in `explicit`), read `usePresentableSections()`
     (`lib/presentableSections.ts`): the wrapper computes it synchronously
     from the MDX children, so an empty set IS authority (a page outside a
     `DocumentPage` — the catalog — has no wrapper, and the empty default is
     the signal). Consumed today by `content/mdxHeading` to paint the
     `Presentar` button (#256, ADR-0051).
   - **Being inside something that has already spoken for you.** A container that
     carries one accessible name for a whole group wraps its children in
     `<DescribedProvider value={true}>` (`components/described.ts`), and a
     component that would otherwise demand its own description reads
     `useDescribed()` and accepts silence instead. Same shape as `embedded.ts`,
     one level up: that one is about chrome, this one about voice. Worked case:
     `<Mosaic>` × `<Figure>` (#119, ADR-0029) — nine logos read as one sentence
     rather than nine brand names, and `Figure`'s "alt is required" rule keeps its
     single exception where the description already is.
   - **Drawing something tall on a slide.** A slide is fit and uniformly scaled,
     never clipped (ADR-0013 §5.1), so a block that asks for more height than
     the stage has does not get cut off — it shrinks the WHOLE slide, the title
     with it. Cap against `SLIDE_BUDGET_VH` (`components/slideBudget.ts`), never
     a private copy of the number: the two current users each declared it
     privately and each claimed in a comment to be using "the same budget" as
     the other, which nothing checked (#146 review). Worked cases: `<Mosaic>`
     splits it across rows, `<SheetEmbed>` clamps its frame to
     `min(height, SLIDE_BUDGET_VH vh)`.
   - **Inside `interactive/`**, reuse `Panel` (a labelled output strip),
     `useRunShortcut` (Ctrl/Cmd + Enter), `useLoadedRuntime` (loads a runtime
     module and hands back a bound `run`, `warm`, `queued` and `ready` — do NOT
     hand-roll the `loadRuntime` effect, both components that did ended up with
     the same 22 lines), `useGrammar` (the CodeMirror grammar for a language,
     asked for SEPARATELY from the runtime: a component that drives a runtime
     without mounting an editor must not pay for a highlighter, #122) and
     `draft.ts` — whose `saveDraft`
     must be called immediately _before_ a run, never after, because a Java loop
     that never ends is the case it exists for (ADR-0020 §2).

3. **Register it** in the shell MDX map (`apps/web/src/app/mdxComponents.ts`).
   Not optional: the catalog and the MDX map must be the same set, asserted in
   both directions. A component that must NOT be document-facing therefore does
   not get a catalog entry either — it is not a content component (ADR-0014).
4. **Write the catalog entry**: `<Name>.catalog.tsx` beside the component,
   typed as `CatalogEntry` (`lib/catalogEntry.ts`), with description,
   when-to-use, full props table, and ≥2 live examples (both modes when
   behavior differs). Add it to the array in
   `apps/web/src/components/catalogEntries.ts` — an entry that never reaches that
   array is invisible to the catalog. That module is deliberately NOT the seam:
   the seam reaches it through `loadCatalogEntries()`, behind a dynamic import,
   because the shell reaches the seam eagerly and the entries are documentation
   for authors, not payload for readers (#122; the weight is in ADR-0018
   §Consequences, and it grows with every component, which is why the guard is a
   test rather than a number on every course
   page). Nothing outside the seam may import it, and `src/architecture.test.ts`
   walks the eager graph to keep it that way.
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
   what catches an entry never added to the `catalogEntries.ts` array.
6. **Verify**: per-commit protocol green; review the PR against the review
   checklist (`/catalog/governance`).

### Heavy components register through a lazy wrapper

The shell builds `mdxComponents` eagerly, so **any** static import of a
component from a module the shell reaches puts that component — and everything it
imports — in the entry chunk, paid by every reader of every page. Since #122 the catalog entries themselves are behind a dynamic import and no
longer a route into the entry chunk, but a `*.catalog.tsx` still imports the
component it documents, so the lazy wrapper is what it must name — and what it
guards is now the CATALOG's chunk: a static import there puts CodeMirror in the
chunk every `/catalog` page fetches, including `/catalog/governance`, for
examples the reader may never scroll to.
`CodeEditor` brings CodeMirror: registering it directly roughly doubled the
entry chunk (measured in ADR-0018 §7).

When a component carries a heavy dependency, add a `lazy<Name>.tsx` beside it
that wraps `lazy()` in a `Suspense` with a sized placeholder — which answers
`useEmbedded()` too, or the doubled frame is on screen for the whole chunk
fetch — export **that**
through the seam, and register it in the MDX map. Its catalog entry must import
the wrapper too — the entry is reachable from the shell, so a static import
there undoes the split just as effectively. Worked case:
`components/interactive/lazyCodeEditor.tsx`, guarded by an L4 case in
`src/architecture.test.ts`. **Two guards now apply.** Yours is per-component: copy
its "stays out of the entry chunk" describe block for your component, with your
own wrapper in `ALLOWED`, or nothing checks you. The
second is generic: `architecture: what the shell reaches eagerly` walks the
static imports from `app/main.tsx` and fails if the graph reaches `runtime/`,
reaches `components/catalogEntries.ts` or any `*.catalog.*` file, or pulls a
package outside `SHIPS_EAGERLY`. **Never add a name to that list to go
green** — that is weight on the first paint of every page, including the ones
with no code; treat it like disabling a lint rule and ask first. And if you
only need a CONSTANT from a feature (a list of ids, a union type), put it in
`lib/` and import it from there: importing the feature seam for it pulls the
whole feature (worked case: `lib/runtimeIds.ts`, #85, which took the eager
payload from 1 chunk to 9 with every name-based guard green).

## Checklist

- [ ] Family chosen; the contract points satisfied — including the `h2` one if
- [ ] If the change adds or alters a prop a COURSE author writes, update
      that component's section in `guides/add-a-course-document.md` in the
      same PR. The catalog and the guide are two homes for two audiences,
      and this line is the only thing keeping them in step — worked case:
      `<Mosaic plate>` shipped documented for component authors and
      invisible to course authors (#120 review).
      the component marks a section, and the measure one if it renders wide.
- [ ] **If the family was empty before this PR**: you created its folder, and you
      moved the one hardcoded empty-family case in `app/catalogRoute.test.tsx`
      (it names `/catalog/semantic` today — `media` having been populated in #119 —
      and fails with instructions when semantic stops being empty) to a family
      that is still empty — the other empty-family tests find the empty family
      themselves and need nothing. Keep the
      rendered-English `it.each` list covering one populated and one still-empty
      family page.
- [ ] Registered in `app/mdxComponents.ts` (mandatory for every catalogued component).
- [ ] Component exported from `src/components/index.ts` — the shell imports the
      seam, not the file. The ENTRY is not exported there; the two go to different
      places and that is the whole point of #122.
- [ ] Colocated `.catalog.tsx` entry added to the array in
      `src/components/catalogEntries.ts` — and NOT re-exported from
      `src/components/index.ts`, which puts every entry's prose back in the eager
      payload (#122, guarded by `never reaches the catalog entries` in
      `src/architecture.test.ts`).
- [ ] ≥2 live examples; per-mode tests; completeness test green.
- [ ] Wide output carries `.not-prose` or `.measure-full`, checked in the book
      view of a real document (`npm run build && npm run preview`), not only in
      `/catalog` — which does not apply the reading measure.
- [ ] If it draws something tall on a slide: capped against `SLIDE_BUDGET_VH`
      (`components/slideBudget.ts`), not a number of its own.
- [ ] If it embeds another origin: verified in a real browser per
      `testing-strategy.md` §Conventions, third class — the frame paints, each
      permission re-measured, network weight from a cold profile, and a sideways
      drag on a touch context. No test at any level can see any of it.
- [ ] If it carries a heavy dependency: lazy wrapper registered instead of the
      component, catalog entry importing the wrapper, its own L4 case copied in
      `src/architecture.test.ts`, entry chunk unchanged in `npm run build`.
- [ ] PR reviewed against the catalog's review checklist.
