# ADR-0051: Slide deep-linking by slug — `?section=<slug>` on entry, `#<slug>` on exit

**Status:** Accepted
**Date:** 2026-08-27
**Decision-makers:** Miguel Rodriguez
**Covers:** `?section=<slug>` on `/d/:id/present` (URL contract) ·
`SlideDeck.leave()` publishing `#<slug>` when the current slide has one ·
`PresentableSectionsWrapper` + `lib/presentableSections` (the book-side spine
publication) · the per-h2 "Presentar sección" button in `content/mdxHeading`
**Source:** Issue #256.
**Extends:** ADR-0013 (presentation pipeline / `?slide=N` URL contract, and
the `<SectionBreak/>` = untitled group boundary at §Decision 1) — this is
the same URL as source of truth, gaining a second query key for a stable
addressee, and the untitled-group rule is why an anonymous group publishes
no slug. Reads from ADR-0021 (rendered h2 IS the section spine) and
ADR-0027 §8 (a published anchor is frozen) — the slug is already the book's
h2 id, so a bookmarked `?section=<slug>` outlives a renumbering of the deck.

## Context

A reader of the book had no way to say "show me THIS section as slides
without walking to it": the top-bar "Presentar" toggle enters
`/d/:id/present` and lands on slide 1 (the cover), and inside the deck the
reader clicks their way forward. The book already publishes `#<slug>` on
every h2 (`content/mdxHeading.tsx`); presentation had no counterpart, and
`SlideDeck.leave()` returned readers to `/d/:id` with no fragment, so a
reader who was watching a middle slide came back to the top of the book and
scrolled to find their place again.

The two halves are symmetrical: the book-to-deck direction wants a stable
addressee (a slide the reader can bookmark, share, or land on from any h2
in the book), and the deck-to-book direction wants to return the reader to
the same section they were watching. Both are the same information under two
different URL keys — a slug identifying a slide title.

## Decision

Add a slug-based deep-link contract, in both directions, using the same slug
the book's h2 anchors already publish.

### Entry: `GET /d/:id/present?section=<slug>`

Loads the presentation and shows the slide whose title slugs to `<slug>`.
Rules:

- **Wins over `?slide=`** when both are present. `?section=` is the stable
  addressee (a bookmark to `?slide=5` breaks the moment slides are
  renumbered); `?slide=` remains the canonical intra-deck form.
- **Unknown slug falls back to slide 1** — same tolerance as an out-of-range
  `?slide` (the pre-existing clamp). Never a white screen.
- **Canonicalised on mount** to `?slide=<N>` with `{ replace: true }`. The
  URL is the source of truth (ADR-0013), and the browser history must hold
  one shape only: without this, the back button after a `?section=` entry
  returns to a `?section=` URL the deck already resolved, and every intra-
  deck arrow key writes a `?slide=<N>` that shadows it.

### Exit: `SlideDeck.leave()` publishes `#<slug>` when the current slide has one

`Escape` and the footer's X button navigate to `/d/${docId}#${slug}` when
the current slide is titled (its slug is defined). Without a slug — the
cover, an anonymous `<SectionBreak/>` group — the navigation stays
fragment-less, matching the pre-#256 behaviour for those two cases.

- **Cover has no slug on purpose.** The top-bar "Presentar" button lands on
  the cover; publishing the cover's slug on exit would round-trip the
  reader to the same spot they came from.
- **The browser handles the scroll.** `mdxHeading` already renders
  `id={slug}` with `scroll-mt-8`, so no code in the deck touches the
  fragment beyond the URL — one publication site, one scroll behaviour.

### Publishing the presentable spine to the book

The book side needs to know which of its h2s are slide boundaries with a
slug, so `mdxHeading` can paint a "Presentar sección" button next to the
`#` anchor only where the button will actually resolve. This is different
from the `useSections` DOM walk (which lists ALL rendered h2s): in
`explicit` mode a document has h2s that are book-only (loose prose sections
like `Ejercicios` in `java-tipos-y-flujo`), and those must not carry the
button.

`PresentableSectionsWrapper` (in `presentation/`) is an MDX wrapper
`DocumentPage` mounts around every document. It runs the same
`mdxChildrenOf` → `computeSlides` recipe `SlideDeck` uses, collects the
S1 slugs into a Set, and publishes them along with `docId` through
`lib/presentableSections`. The context lives in `lib/` — like
`knownSections` — because provider and consumer sit in different features
(`presentation` publishes, `content` consumes) and `content → presentation`
is not an edge in `FEATURE_EDGES` (`src/architecture.test.ts`); sharing
through `lib` avoids introducing that cross-feature edge for a single
value.

The wrapper is prop-injected into `DocumentPage` by `AppRoutes` (the same
shape `notFound` already used), so `content/` never imports
`presentation/` directly. A page outside `DocumentPage` — the catalog,
family pages — never mounts the wrapper, and the default context value
(`docId: null`, empty set) leaves `mdxHeading` silent. No per-surface
exception was written; the absence of a wrapper is the signal.

### The button in `mdxHeading`

`mdxHeading` paints a lucide `Presentation` icon inside a react-router
`<Link>` to `/d/${docId}/present?section=${slug}`, as a keyed sibling of
the existing `#` anchor. Same visibility rules (`opacity-0` +
`group-hover:opacity-100` + `focus-visible:opacity-100`); same silent
fallback for a text-less heading (a formula-only `##`, per ADR-0027 §8,
still paints nothing). The gate combines three independent facts so a
regression in any silences the button without a false paint:

- `level === 2` — h3/h4 live INSIDE a slide, never at a boundary.
- `docId !== null` — no wrapper, no button (catalog and friends).
- `presentableSlugs.has(slug)` — the loose-h2 exclusion in `explicit` mode.

`aria-label="Presentar la sección «{título}»"` in Spanish (CLAUDE.md
§Language). The icon is `aria-hidden`; a screen reader announces the
section, not the glyph.

## Alternatives considered

- **A keyboard shortcut ("present the h2 I'm looking at")** was left out
  of scope: the atomic ask was a book-visible entry point that survives
  reordering. The `?section=` contract makes such a shortcut cheap when
  it is written.
- **Route path segment `/d/:id/present/:section`** was rejected: the deck
  URL is a query-key surface (ADR-0013), and adding a route path segment
  would fork parsing between two URL shapes for the same fact and break
  the S2 canonicalisation to `?slide=N`.
- **A registry map from slug to slide index at build time** was rejected:
  the slide model is authored in JSX, not in metadata; a build-time map
  would drift the moment an author renamed a slide title without editing
  frontmatter, and the runtime walk (which is already done for the deck)
  is cheap.

## Consequences

- Two URL shapes reach the same slide: `?slide=N` (canonical, what the deck
  writes) and `?section=<slug>` (deep-link, what a bookmark preserves). S2
  canonicalises `?section=` to `?slide=` on mount, so the history always
  holds the canonical form after the first render.
- **A slug is now a public presentation contract**, on top of the existing
  book-anchor contract (ADR-0021). Renaming a slide title breaks two live
  URLs at once. The fix is the same in both cases: keep the title stable
  once shipped, or accept the breakage as part of the change.
- **Slug collisions within a document** — two slide titles that slug to the
  same string — resolve to the first slide (`Array.findIndex` in `SlideDeck`
  and `Set` de-duplication in the wrapper). This is the same behaviour the
  book's `#` anchor already had; no report is open against it, and this WP
  did not resolve it. Recorded here so a future author looking at either
  spine finds one story.
- **A tiny extra walk per book page**: `PresentableSectionsWrapper` runs
  `computeSlides` once per document render. Same cost the deck already
  pays, on a document that would render anyway. Not measured, and did not
  need to be — the walk is O(children) over the same tree React was about
  to render.
- **The two spines now share three helpers**: `slugify` (already shared),
  `computeSlides` + `mdxChildrenOf` (already in `presentation/`, imported
  by the wrapper from there). If the book slug and the slide slug ever
  diverge, the fault will localise to one of these three files.

## Not yet proven

- **Sharing links to sections in the wild.** The whole WP exists so a
  reader can send a link to a specific section-as-slides; we do not know
  yet whether readers do that. If they do not, the button is dead weight
  we could hide; if they do, we may want the book-view h2 to expose a
  richer share affordance (a copy button, an OG image). Wait for evidence.
