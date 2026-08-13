# ADR-0013: Presentation pipeline — slide grammar, mode routing, MDX children adapter

**Status:** Accepted
**Date:** 2026-08-07
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #64 (WP3, presentation mode). Extends ADR-0010 (component
contract, which defined the two render modes) and ADR-0012 (content pipeline);
details the seam ADR-0008 deferred ("sync is a navigation state").

## Context

D15 makes every document dual: one MDX source renders as a book page and as a
slide deck. Building it forced four decisions: how a document becomes slides,
how boundaries are recognized across features, how the viewer obtains the
rendered content from MDX v3, and where the mode lives so v0.3 live sessions
can drive it.

## Decision

1. **Slide grammar** (runtime, `presentation/parser.ts`, pure and unit-tested):
   a document's sibling elements are grouped into slides. Boundaries: `<Slide>`
   containers (one slide each, title = viewer chrome), `<SectionBreak/>`
   (untitled group), and — in `auto` mode — `h2` headings (heading text =
   slide title). The **cover slide always exists** (document title; content
   before the first boundary joins it in auto mode). The document `h1` never
   enters a slide. In `explicit` mode loose prose stays book-only unless it
   follows a `<SectionBreak/>` — a curated deck.

2. **`presentation` frontmatter field**: `auto | explicit | none`, absent =
   `auto` (every document is presentable for now; future document types arrive
   as new values by real need). Invalid values fail the build via the
   contentIntegrity gate. `none` hides the Presentar toggle and `/present`
   redirects to the book view. Extends the ADR-0012 frontmatter contract.

3. **Boundary identity travels as static metadata** (`lib/componentMeta.ts`:
   `withMeta`/`metaOf` — components declare `slideBoundary` / `headingLevel`).
   The parser dispatches on metadata, never on component-identity imports.
   Chosen over direct imports to keep the feature graph acyclic
   (content → components → presentation → content would otherwise close).

4. **MDX children adapter** (`presentation/mdxChildren.ts`): MDX v3 hands the
   layout wrapper ONE opaque `_createMdxContent` element, not the sibling list
   (that was v1 behavior). **Option A (decided with Miguel, 2026-08-07): invoke
   that compiled content function during render** to obtain the siblings — a
   known coupling to the pinned toolchain's compiled shape, guarded by the
   presentation route tests (including the explicit-marker fixture).
   **Fallback (option B, if an MDX upgrade breaks the shape)**: group slides at
   compile time with a remark plugin over the mdast (wrap boundary runs, inject
   a slides metadata export) — swap the adapter; parser and viewer unchanged.
   This departs from ADR-0012's suggestion that the `?frontmatter`
   virtual-module pattern could serve slide metadata: that pattern serves
   build-time metadata well, but slides need the *rendered element stream*,
   which only exists at runtime under option A's model.

5. **Mode is set by the route; the URL is the sync seam**: `/d/:id` = book,
   `/d/:id/present` = presentation (`ModeProvider` + `useMode()`, never props
   drilling), and the current slide derives from `?slide=N` — the URL is the
   single source of truth. This is the concrete seam for ADR-0008 live
   sessions: sync-follow = driving route + query from `location` events;
   detaching = navigating freely. Viewer chrome is POC-style (fixed overlay,
   keyboard `p`/`←`/`→`/`Space`/`Home`/`End`/`Esc`, fullscreen via
   `requestFullscreen`, minimal framer-motion fade).

   **5.1 A slide is fit, not reflowed** (#99). It is laid out at its design
   size and uniformly scaled down (`presentation/fit.ts`, capped at 1 so a big
   screen shows design size rather than a blown-up slide) so that it fits its
   stage. Reflowing was the alternative and is rejected: it moves every line
   break, so the slide the author built is not the slide the reader sees.
   Clipping was the status quo and is what this replaces — measured 2026-08-13,
   slide 9 of `java-desde-cpp` lost 69px at 1440x900 and more on a phone. The
   consequence an author feels: nothing is cut any more, but a dense slide
   shrinks, and below roughly half scale it stops being readable on a phone.

   **5.2 Touch is a second input path** (#99): a one-finger horizontal swipe
   moves one slide (a second finger is a pinch, and zooming is not navigating).
   Keyboard and finger funnel through one clamped `go()`, so `?slide` stays the
   single source of truth. Unlike a key, the swipe needs no portrait gate: it
   hangs off the slide stage, which the rotate panel replaces rather than
   covers. A new input author should know which of those two shapes theirs is.

   **Constrained by ADR-0023** (#91): on a coarse pointer in portrait the deck
   is replaced by a rotate panel — a second case where `/present` paints no
   slide, and unlike `presentation: none` it does not redirect. While that panel
   is up every slide key above is silenced at the window listener (`Esc` alone
   stays live) and fullscreen is exited. A new deck shortcut wired at window
   level inherits that gate or it will move `?slide` behind a panel showing no
   slide.

## Alternatives considered

- **Compile-time slide splitting** as the primary mechanism (mdx-deck style):
  robust, public APIs, but more build machinery, two artifacts per document,
  and the runtime parser is simpler while documents are components. Kept as
  the recorded fallback (Decision 4).
- **Boundary recognition by component reference** (issue's original wording):
  rejected — it wires the feature cycle componentMeta exists to prevent.
- **Mode via prop drilling or global store**: rejected (ADR-0004/state rules;
  the route already encodes it).
- **Slide state in React state instead of the URL**: rejected — kills deep
  links and the v0.3 sync seam.

## Consequences

- Authors control decks with frontmatter + two markers; the authoring guide
  documents the contract (`docs/standards/guides/add-a-course-document.md`).
- `Slide`/`SectionBreak` ship BEFORE the catalog exists (deferral recorded in
  issue #64 Non-goals; issue #65 makes their catalog entries its first
  obligation and adds the every-component-has-an-entry test).
- The MDX upgrade path is constrained by the adapter (Decision 4): any MDX
  major bump must run the presentation route tests and, on breakage, execute
  the recorded fallback instead of patching around it.
- The security posture of executing compiled content functions rests on the
  repo-controlled-content invariant recorded in `docs/security-notes.md`.
- Cross-feature edges are now an explicit allowlist enforced by
  `src/architecture.test.ts` and recorded in `frontend-code-style.md`.
