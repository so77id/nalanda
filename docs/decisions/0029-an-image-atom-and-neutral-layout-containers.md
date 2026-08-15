# ADR-0029: An image atom, and layout in containers that do not know what they hold

**Status:** Accepted
**Date:** 2026-08-14
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #119. Extends ADR-0003 (MDX format) and ADR-0010 (component
contract); applies ADR-0002 (content model), ADR-0013 (presentation), ADR-0022
(the reading measure) and ADR-0026 (colour).

## Context

Before this WP a Nalanda document could not show a picture, and the way it failed
was silent. MDX compiles `![alt](./x.svg)` into a literal string attribute, and
Vite transforms imports, not strings. Measured on `main`: the build stayed green,
emitted no asset, and `./spike.svg` survived verbatim into the document chunk —
so under `/nalanda/` the browser resolved it against the document's route and
404'd. The dev server, which serves at `/`, hides that entirely.

The gap was not only "no image". Of the ~22 slides of the course opening class
(#120), **nine carry a diagram or a logo mosaic**, and three of those are square
logo mosaics that no single-image component can build. Several others want the
figure _beside_ the text rather than under it.

The one two-column component in the tree does not serve that. `SideBySide` is
code-shaped by construction: each column draws a border and an uppercase language
chip, and type shrinks to `0.72em` in presentation because a `<pre>` is what it
expects to hold — measured in ADR-0022 and #76. A picture inside one renders in
something that looks like a listing.

## Decision

### 1. An atom plus neutral containers

`<Figure>` is one image with its alternative text and, optionally, its caption.
Layout lives in containers that do not know what they hold: `<Split>` places two
blocks side by side, `<Mosaic>` places N in a grid. A figure never grows a prop
about its neighbours.

### 2. Two families, because the taxonomy already said so

`Figure` → `media`, its first habitant. `Split` and `Mosaic` → `structure`, whose
definition in `catalog/families.ts` already promised "future layout blocks".

### 3. `Split` is new; `SideBySide` is untouched

Two two-column components ship deliberately. The difference is behaviour, not
decoration: `SideBySide` declares itself a frame, so an editor inside it drops its
own chrome (#85, ADR-0024); a `Split` declares nothing, so whatever it holds
renders exactly as it would alone.

**Deferred consolidation, with a trigger.** They are duplicated layout, and one
day they should be one primitive — `SideBySide` becoming a variant, or its chrome
moving into the column's content where it belongs. Not now, for three reasons: it
would change a component already used in published content
(`06-java-desde-cpp.mdx`), the contracts differ in more than looks (child count,
embedding, type scale), and nothing had yet seen a `Split` in real use. Revisit
**when a third two-column need appears, or when a `Split` in real content wants
any part of `SideBySide`'s chrome.**

### 4. A mosaic speaks once

`<Mosaic>` carries a required `description` — the accessible name of the whole
group — and its cells go silent (`alt=""`). A screen reader announces one
sentence instead of nine brand names in a row. This is the **only** exception to
"alt is always required", and it lives in the container
(`components/described.ts`, same shape as `embedded.ts`), so `<Figure>`'s own rule
stays absolute: an empty alt outside a describing container is an authoring error,
and a _missing_ alt is an error even inside one — silence has to be something the
author wrote.

`columns` is required and never inferred from the child count: six figures are
3×2 or 2×3 depending on intent, and inference picks one silently.

### 5. Assets live beside the document, addressed relatively

`remarkContentImages` rewrites a relative reference — markdown `![]()` and the
`src` of any JSX element — into `asset:<path from content/>`. Purely syntactic,
exactly like `remarkWikiLinks`; `lib/contentAssets` resolves those keys at render
time against an eager `import.meta.glob`, which is what makes the deployed base
path correct.

The glob asks for `?url&no-inline`. Measured: inlining put a 1.2KB SVG into the
entry chunk (502.60 → 505.02 kB) and would have grown with every logo; as separate
files the same asset costs 0.78 kB of map, and the map grows with the **number**
of assets rather than their bytes (four more images: +0.4 kB).

`no-inline` is also load-bearing for security, not only for bytes: it keeps a
content SVG rendering through `<img src>` (script-inert) rather than as inline
markup. See `security-notes.md` §"Content images render through `<img src>`" —
the two records govern one lever, and neither may be reversed alone.

### 6. Size is a per-view rule, and both halves were measured

In the book an image keeps the dimensions of its file, bounded by the column. On a
slide a mosaic cell fills its column, and the cell height is capped **per row** so
the grid cannot outgrow the stage.

Measured at 1024×768 and 1440: four 160px SVGs projected sat as smudges in a sea
of background, while forcing the same fill in the book blew one up to 384px with
lettering bigger than the document's own headings. The per-row cap exists because
the deck answers an oversized slide by scaling **all** of it down (ADR-0013) —
text included, and below roughly half scale the body stops being readable. A 3×3
staged in presentation mode measures 54vh against a 64vh budget.

A container also zeroes the vertical margin a `Figure` carries for standing alone
in prose: inside a cell it is dead space fighting the layout's gap — 144px of it
across three rows, which took a 3×3 from 54vh to 73vh.

### 7. A missing image blocks publishing, not writing

It renders a visible broken box and warns, exactly as an unresolved wiki-link does
(ADR-0002), because writing twenty-two slides before drawing nine diagrams is a
real order of work — and failing the build would take the dev server with it, so
an author could not preview the document they are drafting.

The gate therefore sits in the suite (`content/architecture.test.ts`), one case
per image reference: it does not block writing and it does block publishing
(pre-PR protocol + CI). It reads the source and touches the filesystem — a second
opinion rather than a re-run of the plugin, so a bug in the plugin's path
arithmetic cannot make both agree that a missing file is fine.

## Alternatives considered

**Layout props on `Figure`** (`side="right"`, `columns={3}`). Rejected: it makes a
figure responsible for its neighbours, and a mosaic needs sibling figures to know
about each other.

**A data-driven `<Gallery images={[...]}>`.** More compact for nine logos, but a
cell could then never hold a caption, a link, or anything that is not an image.

**Generalising `SideBySide` with a `variant`.** Fewer components, but it changes a
component already used in published content and merges two contracts that differ
in child count, embedding and type scale. Deferred with a trigger instead (§3).

**Compiling images into real ESM imports** (`remark-mdx-images`-style). Vite would
fingerprint them with no runtime map, and per-document chunking would beat an
eager one. Rejected on testability: `evaluate()` in the suite compiles MDX with no
bundler, so an import resolves nowhere and the pipeline test that catches the
original defect could not exist. The `asset:` scheme keeps the plugin syntactic
and the resolution testable, and it matches the precedent one file over.

**Failing the build on a missing image.** Strictest, and it blocks the dev server
at `buildStart` — the one moment an author needs the page most. Replaced by the
suite gate (§7).

## Consequences

- Two components in `structure/` do two-column layout. The duplication is
  recorded, with the trigger in §3; a reviewer finding it should read this section
  before proposing the merge.
- `media` is no longer empty, which moved the hardcoded empty-family case in
  `app/catalogRoute.test.tsx` onto `semantic` — the family now waiting for its
  first component.
- Every content image lands in an eager map. It holds short URLs, so it grows with
  the number of assets (~100 bytes each) and not their size; if a course ever
  carries hundreds of images, revisit with a non-eager glob.
- A drawn asset must fix its own colours, because an `<img>` never sees the page's
  `currentColor`. That is a rule for the author, documented in the guide, and the
  only place it can be checked is a screenshot in both themes (ADR-0026).
- Two slide counters in `presentationRoute.test.tsx` moved, because the documents
  they name gained a slide. Their subject is the loose prose staying out of the
  deck; the number is the vehicle, and it now says so in place.
