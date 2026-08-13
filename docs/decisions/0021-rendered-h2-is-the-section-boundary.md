# ADR-0021: The rendered `h2` is the section boundary, for presentation and for navigation alike

**Status:** Accepted
**Date:** 2026-08-12
**Decision-makers:** Miguel Rodriguez
**Covers:** where a document's section spine comes from · why it is read from the DOM
rather than from the source · what a structural component must render to stay navigable
**Source:** Issue #84 (WP: the reading shell on a phone and inside a document).
Extends ADR-0013 (presentation pipeline) and ADR-0010 (component contract);
constrained by the import direction in `frontend-code-style.md`.

## Context

A document needed an "on this page" list: its sections, the one being read, and
a way to jump between them. The sections had to come from somewhere, and the
repo already sliced documents into sections twice — in presentation mode.

`presentation: auto` cuts a slide at every `h2`. `presentation: explicit` cuts
at `<Slide>` and `<SectionBreak/>` instead. Two different rules, one of which
does not mention headings at all. On the face of it, in-document navigation
needed a third rule, or a way to reuse the slide parser.

Reusing the parser was not available. `computeSlides` lives in `presentation/`,
and the allowed cross-feature edge runs `presentation → content`, not the
reverse: `content/` may not import it (`frontend-code-style.md`, FEATURE_EDGES).
Inverting the edge to expose the parser would make the content feature depend on
presentation to render a book page — the wrong direction for a platform whose
book view is the primary one.

A build-time table of contents (a remark plugin collecting headings into
frontmatter) was the other obvious option. It would have meant touching
`vite.config.ts`, a confirmation-gated file, and it would have produced a
*third* notion of "section" — one computed from the source tree, which is not
necessarily what the page paints.

The observation that resolved it: `<Slide title>` renders its title through the
MDX-mapped `h2` (`components/structure/Slide.tsx` reads `useMDXComponents()`),
precisely so section anchors apply to it. In the book view **both modes already
end as `h2` elements in the DOM**, each carrying the slug id `mdxHeading.tsx`
gives it. The spine was not missing; it was unexposed.

## Decision

**The rendered `h2` is the section boundary of a document.** In-document
navigation reads the section list from the article that was painted —
`container.querySelectorAll('h2[id]')` in `content/useSections.ts` — not from
the MDX source and not from the slide parser.

Three consequences are part of the decision:

1. **One spine, any number of presentations.** `useSections()` is the only
   producer; the desktop rail and the mobile drawer are two renderers of its
   output. Deleting either leaves the other working.
2. **A structural component that hides its heading leaves the section
   unnavigable.** Rendering the MDX-mapped `h2` in book mode is part of the
   contract of any component that marks a section — `<Slide>` today.
3. **The list is re-read when the article changes.** Documents arrive behind
   `Suspense`, so a one-shot read on mount finds an empty article; a
   `MutationObserver` on the container keeps the spine in step.

Depth is fixed at `h2`. `h3`/`h4` render anchors and remain deep-linkable, but
they do not enter the rail: the rail mirrors the slide-level structure, which is
what a reader navigates by.

## Alternatives considered

- **Import the slide parser from `content/`.** Rejected: it reverses an
  allowlisted feature edge and makes the book view depend on presentation.
- **A remark plugin emitting a TOC into frontmatter.** Rejected: touches the
  confirmation-gated `vite.config.ts`, and introduces a third definition of
  "section" derived from source rather than from what rendered. It would also
  have to re-implement `<Slide title>` handling — a JSX prop a markdown-level
  plugin does not see as a heading.
- **A separate `<Section>` component authors must add.** Rejected: it makes
  every existing document wrong, and asks an author to declare twice
  (`## Título` and a marker) what they already declared once.
- **Deriving the rail from the slide list in presentation mode only.** Rejected:
  it is the book view that needs the rail; presentation has its own counter.

## Consequences

**Good.** No build step and no config change. Both presentation modes are
covered by one rule, verified against a real `auto` document and a real
`explicit` one. Authors get section navigation with no new syntax. The
`content → presentation` dependency stays absent.

**Costs.** The spine exists only after paint: a server-rendered or
pre-generated TOC is not available from this seam, and anything wanting sections
without rendering the document would need the build-time plugin this ADR
rejected. The rail is also blind to sections a component renders *without* an
`h2` — which is exactly consequence 2 above, and why it is written down here
rather than discovered later: a `<Slide>` that stopped rendering its heading
would silently empty the rail, with a green suite.

`IntersectionObserver` decides which section is being read. Where it is absent
(older browsers, jsdom) the list still renders and still navigates; only the
active mark is missing — the suite therefore cannot verify the mark by
scrolling, and a browser check is required for it (`testing-strategy.md`, L5/L8).
