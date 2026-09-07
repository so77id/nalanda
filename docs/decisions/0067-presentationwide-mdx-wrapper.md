# ADR-0067: `<PresentationWide>` — a wrap-to-widen block for presentation slides

**Status:** Accepted
**Date:** 2026-09-04
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<PresentationWide>`, a thin MDX wrapper that
lets a document author widen an arbitrary block past the `<Slide>` prose
column in presentation mode without touching the widget inside · the
extraction of the viewport-breakout dance into a shared hook
(`components/useViewportBreakout.ts`) as the primitive that also serves
`<SortStepper>`, `<StepShow>`, `<MergeStepper>` and `<PartitionStepper>` ·
the split between "widgets that already break out on their own" and
"blocks that need the wrapper" so the two never compose
**Amended by:** #277 (2026-09-07) — the fraction is not optional for a wide
markdown table, and `0.8` is its value (§Addendum below).
**Source:** Issue #268 — Course document "Diseño de Algoritmos ·
Ordenamiento". Two of its slides carry a `<SideBySide>` of two
`<DivideCombineTree>`s and a wide MDX comparison table that the slide's
prose column compressed into an unreadable smudge in presentation while
reading fine in the book.
**Applies:** ADR-0013 (presentation is `<Slide>` under a fit-scale ancestor),
ADR-0029 (structural containers stay layout-only). Uses ADR-0010 (component
contract) and ADR-0014 (catalog entry).

## Context

The presentation `<Slide>` centres and caps its children at the reading
column defined by ADR-0022 and applies a `transform: scale(fit)` on the
ancestor so an authored 1024×720 stage lands inside the viewport intact
(ADR-0013). Two independent constraints hit a wide visual: the prose
max-width squeezes it before the fit-scale reaches it, and the pure-CSS
`w-screen -translate-x-1/2` trick does not escape the centred/padded/scaled
container chain — it snaps to the parent's centred position with the
parent's width.

`<SortStepper>` had already solved the problem for itself with a bespoke
measure + write dance that walks up until it finds the transformed ancestor,
reads its scale, and sets the widget's `width` + negative `marginLeft` so the
post-scale footprint lands at a chosen fraction of the viewport, centred.
`<StepShow>` copied the same body verbatim in #209. A third widget was about
to copy it a third time (the D&C sorting slides), and the sorting document
also needed a way for the AUTHOR to widen a block that is not a widget at
all — a comparison table, two visualisations side by side.

The alternatives considered:

- **Widen the `<Slide>` globally.** Rejected: the prose column is the
  reading contract for slide TEXT (ADR-0022); the fix must be opt-in per
  block, not global.
- **Add a `wide` prop to every widget that might need it.** Rejected: the
  prop would compose poorly with author-side wrapping (double breakout),
  and it does not help the tables/diagrams case.
- **Add a `wide` variant to `<SideBySide>` or `<Split>`.** Rejected: the
  wrapping is orthogonal to whether the block is a comparator or a mosaic.
  Coupling them would force `<PresentationWide>` inside `<Split>` on any
  block that is neither.

## Decision

Extract the measure+write dance to `apps/web/src/components/useViewportBreakout.ts`
— sitting at the components/ root beside `AuthoringError` because both
`interactive/` and `structure/` reach it (frontend-code-style.md §"Not
everything under components/ is a catalog component"). Land a thin MDX
wrapper `apps/web/src/components/structure/PresentationWide.tsx` that
composes the hook and does nothing else. Register it in `mdxComponents.ts`
so an author can write it directly:

```mdx
<PresentationWide>
  <SideBySide left="balanceado" right="degenerado">…</SideBySide>
</PresentationWide>

<PresentationWide fraction={0.75}>…wide table…</PresentationWide>
```

The `fraction` knob defaults to `1` (full viewport). `0.75` is the
recommended value when a slide holds a two-visual comparison: fills the
horizontal room without pushing beyond the slide's visual margins.

The hook is gated on `enabled: useMode() === 'presentation'` at the call
site so book mode leaves the block alone (its natural max-width flow is
right for reading).

**Widgets that already reach the hook themselves must NOT be wrapped a
second time.** Doubling the breakout lands the block off centre and
scaled twice. The catalog entry for `<PresentationWide>` and the
add-a-course-document guide both state this explicitly; a follow-up
architecture guard is not needed today (the current widget set is small
and the misuse fails visibly in the browser).

## Consequences

- Any block the author picks can widen past the prose column in
  presentation — a first-class capability the guide's structural set
  did not carry until now.
- The measure+write body has one home. `<SortStepper>` and `<StepShow>`
  moved to it as part of this WP; a future stepper picks it up for free.
  The nested-`requestAnimationFrame` cleanup leak the extraction inherited
  is fixed here (the inner id is tracked and cancelled), and the
  `MutationObserver`-on-scale-ancestor firing loop that framer-motion
  triggers per transition frame is short-circuited when neither the
  ancestor scale nor the viewport width has changed.
- The wrapper is inert in book mode, so a document that uses it degrades
  cleanly to its natural flow when read rather than presented.
- The API adds no dependency on presentation code from `interactive/` or
  `structure/`: both reach a hook at `components/`, and the hook is the
  only file that talks to the transformed ancestor.

## Alternatives revisited

- A future container that pairs the breakout with an intrinsic layout
  choice (a "wide side-by-side") could be considered, but only when a
  second use for that shape appears — the code-simplification rule
  "delete first, extract second" applies here too. Today the wrapper +
  the existing structural containers cover every case in the sorting
  chapter.

## Addendum — #277 (2026-09-07): the fraction is not optional for a table

**Context.** This ADR's §Decision presents `fraction = 1` as the default and
recommends `0.75` for a two-visual comparison; its example block shows
`<PresentationWide fraction={0.75}>…wide table…</PresentationWide>`. Two
surfaces disagreed with it and with each other: `PresentationWide.catalog.tsx`
shipped an example titled *"Full-viewport wide table"* whose code was a **bare**
wrapper around a table, and `add-a-course-document.md` §6b named chapter 16 as
the worked case for a wide MDX table — a case chapter 16 does not contain.
Chapter 17 (#277) is the first shipped markdown table inside the wrapper, and
looking at it in a browser produced the fact none of the three surfaces had:
**a table at fraction 1 runs flush to both slide edges with its columns
touching.**

**Decision.** For a wide markdown table the fraction is **not optional**, and
its value is `0.8`. `0.75`–`0.85` remains right for a comparison of two visuals
side by side, which is the case this ADR originally described and the one
chapter 16 ships. The component's default stays `1`, because a full-bleed block
with no internal columns — a single wide visual — is a legitimate use; what
changes is that a *table* must never take it.

**Evidence.** Measured at 1440x900 on chapter 17's cost table, `/present`:
unwrapped the table renders 640px wide and the slide is scaled to **0.71**;
wrapped at `fraction={0.8}` it renders 1058px and the slide is scaled to
**1.0**. Wrapping the five wide tables of that document took five of its slides
off the shrink list. The scale is the `transform` on the `motion.div` inside
`[data-testid="slide-stage"]` (`presentation/SlideDeck.tsx`).

**Consequences.**

- `PresentationWide.catalog.tsx` now demonstrates `fraction={0.8}` for the
  table case and its `fraction` prop description carries the measurement — the
  catalog is what an author reads (`add-a-course-document.md` §Worked example),
  so it was the surface teaching the defect.
- `add-a-course-document.md` §6b carries the rule, both values and chapter 17
  as the table worked case.
- **Open question this ADR does not settle:** whether the component's default
  should move from `1` to `0.8`. Every shipped call site overrides it (0.85 and
  0.75 in chapter 16, 0.8 five times in chapter 17), which is the argument for
  changing it; a full-bleed single visual is the argument against. Left as it
  is rather than changed silently.
