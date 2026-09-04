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
