# ADR-0090: `<PenTrace>` widget for tracing a figure without lifting the pen

**Status:** Accepted
**Date:** 2026-11-06
**Decision-makers:** Miguel Rodriguez
**Covers:** the `<PenTrace>` course-content component · the choice of a
dedicated widget vs a `<StepShow>` walk, a `<SequenceStepper>` graph recipe
or a static `<NodeGraph walk>` · its interaction rules · the two modes,
`solvable` (Resolver) and `keepTrying` (Buscar solución), and why they
exclude each other · the shared geometry `nodeGraphLayout.ts`
**Source:** Issue #356 (Grafos · Introducción), AC 11 («un ADR donde la
extensión lo amerite»), and the review of PR #364 that found the judgment
unrecorded.

## Context

The Grafos unit opens on Königsberg: is there a walk that crosses every
bridge once? The class needs the reader to TRY it, fail, and only then meet
Euler's rule, which answers by counting degrees instead of trying orders.
The same holds for the one-stroke figures (the star, the house, the
envelope): the reader draws, gets stuck or finishes, and the rule explains
why afterwards.

Nothing in the repo lets a reader act on a graph. `<NodeGraph>` is a static
drawing. `<StepShow>` walks author-written frames beside a listing: the
reader watches, never chooses. `<SequenceStepper>` runs one operation of a
structure, and its planned `graph` recipe (#357) will run traversals, which
the reader also watches. None of them lets the reader press a point and
draw the next stroke, nor refuses a move.

## Decision

A dedicated, lazily registered widget, `<PenTrace>`, after
`<HanoiPlayground>`'s shape (ADR-0055): the reader plays, the widget keeps
the rules.

1. **Interaction.** The reader presses a point to put the pen down, then the
   points to draw the strokes to. The widget refuses a jump to a point no
   free stroke reaches and a stroke drawn twice, and a status line says how
   many strokes are left, when the tracing is stuck and when it is done, and
   whether it ended where it began. Deshacer and Empezar de nuevo undo.
2. **The rules are pure.** `penTraceLogic.ts` holds them: a step, its status,
   an undo, Hierholzer's tour (`solve`) and greedy failed attempts
   (`attempts`). The component only holds state and timers.
3. **Two modes, exclusive.**
   - `solvable` adds Resolver: it draws one tracing stroke by stroke, or says
     the figure cannot be traced from any point, without saying why. The why
     is Euler's rule, which the class teaches next.
   - `keepTrying` adds Buscar solución, for a question the class has not
     answered yet. It loops through attempts and never says whether a
     tracing exists, because saying so would answer the question the slide
     poses. An attempt that happens to finish the figure stops the search.
   A mount asking for both is an authoring error: one answers and the other
   must not.
4. **Shared geometry.** `<PenTrace>` lays out on `nodeGraphLayout.ts`, the
   pure module `<NodeGraph>` draws with, so a graph looks the same in the
   drawing and in the widget. A tracing's step numbers are the same
   `StepBadge` a `<NodeGraph walk>` draws.
5. **Accessibility.** Every point is a button named «Punto X». The live
   status line holds one fixed sentence while a loop of attempts runs, so a
   screen reader does not read every frame.

## Alternatives considered

- **A `<StepShow>` walk over `<NodeGraph>` frames.** It shows a tracing, but
  the reader cannot choose, so it cannot show the failure the class needs
  the reader to feel.
- **A `<SequenceStepper>` `graph` recipe.** Planned for traversals (#357),
  where the algorithm, not the reader, chooses the next vertex. It shares
  the same objection, and a recipe that took input would change the
  stepper's contract.
- **A static `<NodeGraph walk>`.** The class uses it to show a walk once it
  is known. It does not let the reader try.

## Consequences

- `nodeGraphLayout.ts` is the unit's graph geometry. #357's `graph` recipe
  should lay out on it, as `treeGeometry.ts` serves both `<BinaryPicture>`
  and the tree stepper.
- The widget teaches by failure, so it never names the rule: Resolver says
  «no se puede» without the why, and Buscar solución says nothing at all.
  A future mode that explains must be a different prop, not a change to
  these two.
- It loads on demand (ADR-0055's uniform boundary), so a page without it
  pays nothing.
