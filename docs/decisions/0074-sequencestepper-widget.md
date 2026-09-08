# ADR-0074: `<SequenceStepper>` — one widget for the whole Sequence family

**Status:** Accepted
**Date:** 2026-09-08
**Decision-makers:** Miguel Rodriguez
**Covers:** the introduction of `<SequenceStepper>`, a step-through widget
whose `eda` prop selects WHICH structure is drawn (array, dynamic array,
singly / doubly / circular linked list) and whose `operation` prop selects
WHICH animation runs over it · the decision to build one widget with two
selector props rather than one widget per structure or per operation · the
split of the widget into two pure modules (a frame trace and a layout) plus a
thin painter · the refusal of invalid combinations at boot, addressed to the
author · the palette the states are painted in, and why it is not the one the
design reference proposed
**Source:** Issue #288 — Course document "Estructuras de Datos · Listas
Enlazadas". The class shows nine operations over five structures, and
`teach-a-data-structure.md` §7 defers the unit's widget decision to exactly
this point.

## Context

The Estructuras de Datos unit (Epic #276) draws sequences in at least three
classes. #277 (Introducción) shipped zero new widgets on purpose, using seven
static SVG figures and ten `<StepShow>` steppers whose pictures the author
wrote by hand. #288 (this one) shows every operation of the linked list, in
four variants, and compares each against the array. The next class mounts
Stack, Queue and Deque on top of both the list and the array.

`teach-a-data-structure.md` §7 says not to build a widget for one class of the
unit — *"sketch the animations the whole unit wants, look for the shared
pattern, and only then decide whether to build, extend or reuse"* — and names
the linked-list WP as where that decision gets made. So this is not a widget
invented for #288; it is the unit's widget decision falling due.

Hand-authoring these pictures the way #277 did does not scale to this class.
#277's ten `<StepShow>` steppers each carry an author-written state per frame,
and the author is responsible for the picture being TRUE (ADR-0049). This class
needs roughly ten times as many frames — every operation, over every variant —
and each frame is a chain of nodes with pointers rather than a handful of
variables. Hand-writing them would be both enormous and unverifiable: nothing
in the build or the suite can see a drawing that is wrong.

Three shapes were on the table.

## Decision

**One widget, with two props that select recipe and operation.**

`eda` picks the structure and `operation` picks the animation. The surface —
code panel, structure panel, narration strip, controls — is identical across
every combination, which is itself the pedagogical message: *the operations
are the same; what changes is where the cost lives.*

Five recipes (`array`, `dynamic-array`, `linked-list-singly`,
`linked-list-doubly`, `linked-list-circular`) and eight operations
(`insert-first`, `insert-last`, `insert-at`, `insert-ordered`,
`remove-first`, `remove-last`, `remove-at`, `search`). Thirty-eight of the
forty pairs are valid; the two that are not are `insert-ordered` over the two
array recipes, refused because this course presents order as a variant of the
LIST and never defines an ordered array. That refusal is a boot-time
`<AuthoringError>` addressed to the author, visible in the suite and in
`/catalog`, never a runtime surprise for a student.

**The widget is three pieces, and two of them are pure.**

- `sequenceStepperTrace.ts` — recipe + operation + input → a frame list and the
  Java listing the frames highlight lines of. No DOM, no React.
- `sequenceStepperLayout.ts` — how many cells → where each box, arrow and
  pointer sits. No DOM, no React.
- `SequenceStepper.tsx` — reads a frame, paints one hand-written SVG from the
  layout, and composes `stepperShell` for playback and chrome.

This is the recipe `apps/web/CLAUDE.md` §2 prescribes for anything jsdom cannot
see: *"the way out is to not measure"*. Geometry the component COMPUTES lives
in a module the suite checks exactly, so no test fakes a measurement — the
failure mode that shipped a false positive as the contract in #103. What is
left for the browser is only whether the drawing reads well.

**Every valid combination is a fixture.** `sequenceStepperTrace.test.ts` sweeps
all thirty-eight, asserting each produces a walkable trace whose highlighted
lines exist in its own listing and whose final frame has settled. A change to
one animation cannot silently break another.

**The playback is the shared one.** `useStepPlayback` from
`stepperShell.tsx` — autoplay off by default (the Peli 1/2 rule), paused when
the widget scrolls out of view, reset on a content change. `<SortStepper>`
still carries its own copy of that machinery (ADR-0065 §Amended by); this
widget is built on the shell instead, which is the direction that ADR's
follow-up points.

**The palette is the registered one, and deliberately not the design
reference's.** The refinement conversation proposed coral + emerald + amber,
with amber meaning "new or changed". Amber's nearest registered token is
`flag`, which `design-system.md` reserves for *errors, warnings, diagnostics —
semantic, never decorative*; painting a freshly inserted node with it would
say "something went wrong". So a new or found cell is `keep` / `keep-soft`
(the success pair), a cell under the algorithm's attention is outlined in
`focus` — the same token the narration chip and `<CodeStepper>`'s active line
already use — and `accent` stays on the widget's own chrome, never on data
state. Adopting the reference's palette is a job for the branding WP the issue
files, which would move the TOKENS rather than misuse one here.

**Colour is never the only signal** (`design-system.md` §Rules that are not
about contrast): every painted state also prints a word — `nuevo`, `✓ es
este`, `sale` — and every pointer prints its own name (`head`, `tail`,
`actual`, `previo`) beside its arrow.

## Alternatives considered

**One widget per combination** (`<ArrayInsertAt>`, `<SinglyRemoveFirst>`, …).
Tiny contracts, no flexibility, and dozens of widgets — each with its own
catalog entry, its own tests and its own lazy wrapper. Rejected on volume
alone, and on the certainty that they would drift apart visually.

**One widget per structure** (`<ArrayViz>`, `<LinkedListViz>`, …). Five
widgets, but each with a diverging API, and the controls, code panel and
responsive layout duplicated five times. A change to the control bar would be
five PRs. Worse, the visual coherence BETWEEN structures — which is part of
what the class teaches — would depend on five widgets not drifting, with
nothing checking it. Rejected.

**One widget per operation** (a universal `<InsertFirst>` over any structure).
Rejected because the operation changes little on the surface and almost
everything in the render: animating *insert-first over an array* and
*insert-first over a chain* share nearly no logic. Grouping by operation hides
that difference inside an internal conditional that does exactly what `eda`
does explicitly.

**Extending `<StepShow>` instead.** It is the existing pair for "listing plus a
picture per step", and #277 uses it ten times. Rejected because its contract is
author-written state per frame (ADR-0049): the author supplies each picture.
That is right for a handful of memory diagrams and wrong for ~380 frames whose
truth is mechanical — the trace can DERIVE them, and a derived frame cannot
drift from the operation it claims to show.

## Consequences

- **The author writes less, and the two-structure comparison becomes trivial.**
  A slide showing the same operation over an array and a list is two nearly
  identical tags. That is the shape the comparison act of the class needs.
- **One visual vocabulary.** "Green is new or found", "focus outline is under
  the algorithm's attention", "the pointer prints its name" hold for arrays and
  for lists alike. The reader learns the code once and reads five structures.
- **The complexity is concentrated.** Thirty-eight combinations live in one
  module rather than spread over five. That is a real cost, and it is paid in
  one place with an exhaustive sweep over it.
- **The cost counter is on screen.** Each frame carries a running elementary-
  operation count, so the reader reads $$\Theta(1)$$ against $$\Theta(N)$$ off
  the widget instead of memorising the table — the "show the construction, not
  only the result" rule the widgets of #266 and #268 established.
- **The next class reuses it.** Stack over a list and Stack over an array are
  two tags of the same widget, so *"same TDA, different implementations"* reads
  without translating between widgets.
- **It stays out of the entry chunk.** The widget composes `<CodeStepper>`
  (CodeMirror + the Java grammar), so it registers through
  `lazySequenceStepper.tsx` and carries its own per-name case in
  `src/architecture.test.ts`, like every heavy widget before it.
- **#277 is not ported.** It shipped with static SVGs and is not derailed for
  visual consistency; porting it is an optional later WP, as the issue records.
- **Adding a recipe is a code change with an ADR**, not a hidden flag in an
  `.mdx`. A new structure means a new picture and a new listing, and both are
  decisions the unit should record.
