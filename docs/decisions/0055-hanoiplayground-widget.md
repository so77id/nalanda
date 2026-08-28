# ADR-0055: `<HanoiPlayground>` widget for animating Torres de Hanoi

**Status:** Accepted
**Date:** 2026-08-27
**Decision-makers:** Miguel Rodriguez
**Covers:** the `<HanoiPlayground>` course-content component · the choice
of a dedicated widget vs reusing StepShow/CallStack · the layout (three
pegs + coloured discs + side panel with the recursive call chain) · the
6-disc limit and the fixed A/C/B tower naming
**Source:** Issue #221 — Acto 5 of the redesigned Peli 2 introduces Torres
de Hanoi as a canonical recursive problem. Slides 5.6 (the problem) and
5.7 (the recursive solution) need a widget that makes the algorithm
visible in its native form: physical discs moving between three pegs,
alongside the recursive call chain that produced each move.

## Context

Torres de Hanoi is the recursive puzzle every DS course covers. Its
recursive solution is compact and elegant — three lines of Java describe
an algorithm that produces $$2^N - 1$$ moves. Two things about the
algorithm are worth teaching:

1. **The physical motion of discs** — visualization of the move sequence
   makes concrete what the recursive `hanoi(n, from, to, aux)` does at
   every step. Reading the algorithm without seeing it work is
   deceptively easy.
2. **The recursive call chain** — the reason the algorithm works is the
   nested recursion: move N-1 to auxiliary, move biggest to destination,
   move N-1 to destination. Seeing the chain of active calls next to the
   moves they produce ties the abstract structure to the observable
   effect.

Existing widgets don't cover this together. `<RecursionTree recipe="hanoi">`
(ADR-0056) shows the tree — a global view of every call — but not the
towers or the disc sequence. `<CallStack recipe="hanoi">` shows the stack
depth but not the puzzle state. Neither shows the algorithm EXECUTING on
the puzzle it solves.

## Decision

**1. Adopt `<HanoiPlayground>` as a new course-content component.**
Documents write `<HanoiPlayground arg={4} />`. The widget knows the
algorithm and animates it.

**2. Layout — three pegs + coloured discs + optional side panel with the
recursive call chain.** Two columns:

- **Left**: three vertical pegs (A, B, C), coloured discs stacked by
  size on their current peg. Discs are labelled with their size and
  painted with a rotating hue (by size, in the accent-friendly range).
  Colour is never the only signal — the number on each disc is the
  fallback.
- **Right** (default): a small panel listing the active recursive call
  chain, indented by depth. The topmost (deepest) call is highlighted
  in accent colour. Below that, the last physical move (`disc 3: A →
  C`) is quoted. Hidden with `showRecursiveCall={false}` for slides
  where only the moves are the lesson.

Controls (bottom strip): Play/Pause, Step forward, Step back, Reset,
speed multiplier, and a step counter. Same shape and semantics as
`<CallStack>` — the reader learns one control language for the
recursion widgets.

**3. Fixed tower names A/C/B, fixed initial state (all discs on A,
target C).** The author only picks the number of discs. The two other
degrees of freedom of Hanoi (starting peg, target peg) don't matter
pedagogically — every deck slide uses the canonical setup — and giving
them as props would push authoring complexity for no gain. If a future
deck needs a different setup, we add `from`/`to` props then.

**4. 6-disc maximum.** Above 6 discs the animation is 127+ moves — no
reader can follow it, and the pedagogical point is already made at 4
(15 moves) or 5 (31 moves). At 6 (63 moves) the exponential is
palpable. Authors get an authoring error above 6, redirecting them to
`<RecursionTree recipe="hanoi">` for the structural view.

**5. Playback is manual by default, autoplay is available.** Consistent
with `<CallStack>` (ADR-0054). The professor drives the walk in class;
the autodidacta reader can autoplay if they want. Manual playback with
Step back gives the reader the ability to REVIEW a move they missed —
autoplay alone would force restarting from the beginning.

**6. Discs are colored by size, unique per disc.** Six discs, six hues.
The colour lets the reader track a specific disc as it moves; the
number on the disc is the accessible fallback. When a disc moves, the
container updates but the colour stays — visual continuity as the disc
crosses towers.

**7. The recursive call chain LIST replaces a rendered call stack.**
The panel doesn't need to be `<CallStack>` because Hanoi's recursion is
structurally simple (always two children per non-base call). What
matters is seeing which nested call is producing the current move. A
flat indented list captures that; a full call-stack panel with all the
LIFO plumbing would be overkill and would compete visually with the
towers, which are the primary object.

## Alternatives considered

**Reuse `<StepShow>` with a custom `HanoiVisual` per step.** Rejected
for the same reason `<CallStack>` did not use the `<StepShow>` pattern:
the author would have to write every step manually. For hanoi(4) that's
15 moves + intermediate calls, which is far too verbose. The widget
generates the trace once from the argument.

**Combine with `<CallStack>` into one composite widget.** Rejected: the
tower visualization and the call-stack panel show different things at
different scales, and forcing them into one widget makes both worse.
Two widgets, both used in Acto 5 (`<CallStack>` in Actos 2 and 5;
`<HanoiPlayground>` in slides 5.6 and 5.7), keeps each simple.

**Author-supplied tower state per step** (declarative). Rejected: the
algorithm is well-defined; the widget can compute the trace correctly
from the number of discs. The declarative model buys nothing here.

**Support >6 discs with automatic playback speed scaling.** Rejected:
even at 3× speed, hanoi(8) is 255 moves × a minimum ~150ms per move =
40 seconds of animation. No lesson survives that. The 6-disc cap is a
UX statement, not a technical limit.

**A physics-based animation with sliding discs.** Rejected as premature
polish. The current animation shows discs teleporting to their new
tower on step advance — simple and correct. A sliding transition would
be nicer but adds no pedagogical value; the reader is watching the
tower CONFIGURATIONS, not the motion between them.

## Consequences

**Sixth widget in the interactive family.** Registered lazily via
`<LazyHanoiPlayground>` following the same pattern as the others.
Guarded by `apps/web/src/architecture.test.ts` per-component case for
`hanoiplayground`.

**The widget knows the algorithm.** Adding a variant of Hanoi (e.g.
Frame–Stewart's four-peg problem) requires code changes here, not
author changes in the document. That is the tradeoff of the recipe
model — deliberate.

**The animation is exact.** The trace is generated by executing the same
recursive procedure the source code would produce, so the moves the
reader sees are the moves `hanoi(int n, char from, char to, char aux)`
in the deck's code panel would print. No drift between the animation
and the code beside it.

**Frame-perfect step-back is possible.** The trace is a linear array;
`renderStack` (in `<CallStack>` — same pattern here) replays from step
0 to any step, so Step back is precise. Autoplay pauses at the end.

**Accessibility**: the tower panel exposes an `aria-label` describing
the current state (`torre A tiene 2 discos, torre B tiene 1, torre C
tiene 1. 5 movimientos ejecutados.`) so a screen-reader user gets the
same information as a sighted one. The call chain is an ordered list
with an accessible name. Colour is never the only signal.

**Test coverage covers the state machine directly.** The component
test suite asserts initial state, step forward/back/reset, movement
counter, tower configurations at intermediate and final states,
side-panel behaviour, and both authoring-error paths. Autoplay is not
asserted (jsdom doesn't advance timers legibly).

**No package.json change.** Uses lucide-react (already present),
`useResolvedTheme` (already present), and standard React state.
