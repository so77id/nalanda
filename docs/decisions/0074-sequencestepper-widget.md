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
**Amended by:** #288, slide-by-slide review (2026-09-10) — a ninth operation,
`get-at`. The class needs the operation the array answers with one
multiplication and the list answers by walking, and it is the clearest
contrast the widget can draw: the same tag over `array` produces a single
frame at any position, over a chain it produces one frame per hop. Adding an
operation is a code change, not a flag in an `.mdx` (§Consequences), and this
is that change: engine, listings for both families, tests pinning that no hop
is skipped, catalog examples, and the course-author guide's prop list.

**Amended by:** #288, slide-by-slide review (2026-09-10) — `insert-last`
accepts an ARRAY of values, so a slide can grow a chain from empty at the
BACK the way `insert-first` grows it at the front. Three consequences worth
recording. (a) The listing gains the branch it was missing: with no nodes
there is no last node to link to, so `if (head == null) head = fresh;`, and
the empty case stops being a silent `NullPointerException` in a listing a
student may copy. One `size++` at the end rather than one per branch, because
`lineOf` names lines by TEXT and would silently pick the first of two. (b)
The frame model gains `carry.slot` — which slot the floating node hovers
over, so an operation that grows at the back parks it where the node will
land — and `linkToCarry`, the mirror of `headToCarry` for a node instead of a
variable: the one frame in which a node's `next` has been assigned and the
node it now names has not moved yet. It carries the INDEX of that node, not a
flag, because the node doing the pointing is the last one for `insertLast`
and the previous one for `insertAt` — the same assignment, and the same frame
owed to it.
(c) The `null` terminator and `head`'s empty-chain target are now derived
from the last LIVE cell rather than the last slot DRAWN, and both from one
shared expression: a chain that grows at the back sits flush left inside a
layout reserved for the widest frame, and the two indices differ by every
slot not filled yet. Painted from two copies of that arithmetic, `head` drew
an arrow across the whole canvas THROUGH the `null` it was supposed to reach.

**Amended by:** #288, slide-by-slide review (2026-09-10) — EVERY operation
runs several times, not just the two insertions. `index` and `target` take
arrays; `times` repeats the two operations that take no argument. The class's
operations act is now nine slides of listing-plus-prose each followed by a
widget slide that runs the operation three times, because one run shows what
an operation DOES and only several runs show what it COSTS: the reader
watches `getAt` walk none, three and six nodes rather than reading that the
cost is the position. Two consequences: indices are validated against the
structure as it is BY THEN (three insertions move every position after the
first, so validating against the starting length would refuse a legal
slide), and the call line is COMPUTED rather than searched — two runs of a
method that takes no argument write the same call twice, and `lineOf` hands
both the first.

The same pass closed a hole in two listings. `insertAt` and `deleteAt` walked
to a PREVIOUS node without asking whether one exists: at position 0 `prev`
was still `head`, so both operated on the wrong node — silently, because no
slide had used position 0. They now branch to `insertFirst` / `deleteFirst`,
which is also how the reader should think of that case, and the widget shows
the branch taken.

**Amended by:** #288, slide-by-slide review (2026-09-11) — two additions to
the chrome, both because the widget is watched rather than read. The speed
selector is the one `<MergeStepper>` and `<PartitionStepper>` already carry,
with the same wording and the same three speeds: a reader who learned the
chrome on one stepper of the course should not relearn it here. And `size` is
on screen at every frame, written the way the listing writes it — it is a
FIELD of the structure, every operation ends by changing it, and the reader
should watch that instead of taking the narration's word for it. It replaces
the array recipe's in-drawing `largo · capacidad` caption, which said the
same thing and scaled with the SVG, and it is drawn at a node's size — a
caption-sized one was read as chrome rather than as state.

The chain also gains the index rail the array already had, in the same place
and the same faint ink, so the two pictures can be read side by side. On a
chain the number is a POSITION the reader counts, not something a node
stores, and that is exactly the contrast: the array jumps to it, the chain
walks to it. It renumbers itself after every insertion and deletion, which is
half of what `insertAt` teaches.

**Amended by:** #288, slide-by-slide review (2026-09-11) — the
doubly-linked node is drawn with THREE fields. Its back link used to be an
arrow leaving the left edge of the value half, which is nowhere: `prev` is a
field of the node exactly as `next` is, and a picture that gives one a box
and the other none says the two are different kinds of thing. The layout
reserves the third box, `LayoutBox.prevX` names it, and everything aimed at
"the left edge of the node" — the arrow from the previous node, `head` — now
means that field.

**Amended by:** #288, slide-by-slide review (2026-09-11) — `insert-ordered`
joins the multi-run operations and gets the frame discipline the rest
already had: its two assignments were collapsed into one frame, so the
reader saw the node floating and then standing in the chain. Its listing
gained the front branch for the same reason `insertAt`'s did — the walk
compares `prev.next`, so it can never place a value that belongs before the
first node. And the trace now compares against `prev.next` rather than
against `prev`, which is what the listing does: the two disagreed by one
node.

The circular recipe's closing link was drawn from the last SLOT to slot 0.
On a chain that does not fill the layout — every frame of a chain that
grows — it left one node and arrived at an empty box, and it stayed there
while the chain grew past it. Both ends are read off the live cells now, and
the path is drawn with rounded corners, at the weight of a real link, landing
clear of the index rail rather than through it.

**Amended by:** #288, review pipeline Round A (2026-09-11) — **the validity
matrix.** A combination is valid only when the listing the widget prints
belongs to the structure it is drawing, and most of them did not: every
circular walk still terminated on `null` (an infinite loop on a ring), and
four doubly-linked mutations never assigned `.prev`. One of them was
shipping — the circular recipe showed the open-chain `insertFirst`, which
leaves the last node pointing at the old head and breaks the invariant the
slide beside it had just stated, while the picture drew the ring
re-anchoring with no statement responsible for it.

The alternative was to write the ~20 missing listings. Refused: they are
course material no slide of this class or the next one mounts, and writing
material speculatively is the failure mode this repo has recorded before.
So the widget gives up advertised range instead:

| Receta                   | Operaciones válidas                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `array`, `dynamic-array` | las nueve, menos `insert-ordered`                                                       |
| `linked-list-singly`     | las nueve                                                                               |
| `linked-list-doubly`     | `get-at`, `search`, `insert-first`, `remove-first`, y `remove-last` **solo con `tail`** |
| `linked-list-circular`   | `insert-first` (con listado propio: cierra el anillo, y camina para hacerlo)            |

`isValidCombination` takes `tail` for that last row, and the refusal names
the operations the recipe does have rather than repeating one reason for
every case. The principle worth keeping is the one the narrowing serves: **a
widget that shows Java a student may copy refuses a combination rather than
printing plausible code for the wrong structure.** The same stance is why
every listing carries its guards (`IndexOutOfBoundsException`,
`NoSuchElementException`, `IllegalStateException`) — the rule itself is
course-wide and lives in `teach-a-data-structure.md`.

A second consequence of the same review, on the listings themselves: a
recipe's listing is addressed by TEXT and never by line number, so every
fragment a frame highlights must be unique inside its listing — hence one
`size++` at the end of a branching method rather than one per branch — and
the call line of a repeated multi-run call is COMPUTED, not searched.

**Amended by:** #294, review pipeline Round B (2026-09-19) — **the array
recipes got their first reader, and the deferred question below came due.**
§Consequences said the array recipes ship ahead of their first document,
named the Stack/Queue/Deque class as that reader, and set a trigger: _"if it
does not use them they should be removed rather than re-justified"_. That
class has now shipped, so the trigger fired. Four dispositions, recorded
here because the alternative was leaving them in a commit message.

**`array` stays, but only its PICTURE has a reader.** #294 mounts it twice
(`19-edd-stack-queue.mdx`, the Queue act) and both tags carry
`showCode={false}`, because the class deliberately shows no Java for the
array implementation. So the recipe's drawings are read and its LISTINGS
still are not, one class after this ADR flagged them unread. That is a
narrower outcome than "it has a consumer" suggests, and the next class that
wants array code should know the listings arrive unproofread by any reader.

**`dynamic-array` has a consumer, and the paragraph that gave it a deadline
was wrong within the same WP.** That paragraph said `grep -rn
"dynamic-array" content/` returned nothing "before and after #294", and kept
the recipe against the priority-queue class as a deadline. It was written
while #294's Stack act still built the pila on a fixed block. The class then
moved to the arreglo dinámico — the structure #277 actually ends on — and
the grep now returns two hits, both in the Stack act: `insert-last` and
`remove-last` over `[42, 7]`.

Two facts about that recipe a future author needs, both measured here:
`capacity` starts at `values.length`, so **every `insert-last` opens on the
`grow` frame** — there is no way to show a cheap append with this recipe,
and #294's slide is written around that (it narrates the expensive corrida
and says in prose that the cheap one is the last two steps). And
`remove-last` never shrinks, so the shrink half of `data.length ≤ 4 × size`
is prose, not picture.

`array` keeps its two consumers in the Queue act, where the block genuinely
is fixed — the circular queue — and that is the mount `capacity` exists for.

**The single-run asymmetry is closed, and the argument for leaving it open
was falsified by the next slide written.** §Consequences called it "one
asymmetry to close first". #294's first pass worked around it instead, and
wrote down why the workaround was acceptable rather than a debt: _"three
runs of a $$\Theta(1)$$ operation draw the same frame three times, so the
multi-run form buys a course slide nothing on the array side"_.

That is true of a fixed block and false of a growing one. The push slide of
the second pass runs four `push` over a block of four: the third finds it
full, doubles it and copies — a frame none of the other three draw, and the
one the amortised cost table exists to explain. One run cannot show it.

So `traceArray` now loops over `runArgs` like `traceList` does, sharing
`requireRuns` (the twelve-run ceiling is one number for the whole widget),
`checkIndex` per run, and `callingProgram` — which grew a `receiver`
parameter, because it had been printing `list.insertLast(...)` for every
family and an array slide with `showCode` on would have shown a listing that
contradicted its own picture.

Two things the loop had to get right, both of them things one run never
exercised: a removal is refused against the block **as the previous runs
left it**, not against the author's `values`; and `cost` resets per call, so
each run reports its own arithmetic rather than a running total.

So §Consequences' _"Stack over a list and Stack over an array are two tags
of the same widget"_ is **fulfilled**: both sides now take arrays on `value`
and `times` on the operations that take none.

**And the block drawn is the block the frame HAS.** `layoutSequence` sized
the picture at `max(maxCells, capacity)` so it would not jump between
frames. With one run capacity never changed, so nothing showed. With four,
the first frame drew six cells beside a readout saying `capacidad 4` — the
block filling up, which is the lesson, never happened on screen. The canvas
is now reserved for the widest block of the run (so nothing shifts or
rescales) while the cells drawn are this frame's capacity, so the doubling
is visible and the cells keep their size.

**Amended by:** #294, review pipeline Round B (2026-09-19) — **a listing
that is blind to a prop the picture obeys.** `remove-first` over a singly
list with `tail` is the first combination where the `tail` prop changes the
DRAWING and not the LISTING: `listCode` branches on `tail` for `insert-last`
and `remove-last` but not for `remove-first`, while the layout drops the
`tail` pointer when the chain empties. So the widget draws a queue and
prints a bare chain's `deleteFirst`, without the `if (head == null) tail =
null;` the class itself ships one slide earlier.

**This does not violate the validity matrix above** — that matrix grants
`linked-list-singly` "las nueve" unqualified, and `tail` qualifies only the
`doubly` row, where it decides which listing a recipe belongs to. The
principle _"a widget that shows Java a student may copy refuses a
combination rather than printing plausible code for the wrong structure"_ is
stated there as the rationale for the ENGINE's narrowing, not as a gate
authors must clear. The review verifier ruled on exactly that reading.

The rule this leaves, for the next author who hits a tail-blind listing:
**disclose it in the prose beside the widget, naming the missing line and
the slide that carries it.** #294 does that, and #288 had already done the
same for its own twin (`deleteLast con tail`, whose listing is likewise
`tail`-free). Teaching `listCode` the missing branch is the better answer
and remains available — it is what #288 did for four other listings — but it
is a code change with its own tests, and neither class was willing to buy
widget surgery inside a course-document WP.

**Amended by:** #294, comprehension review (2026-09-20) — **the cost counter
comes off the screen.** §Consequences above says "The cost counter is on
screen... so the reader reads $$\Theta(1)$$ against $$\Theta(N)$$ off the
widget instead of memorising the table". It cannot do that, and the class
that leaned on it is what showed why: a widget animates ONE run, one run
shows one number, and one number is not a growth rate. On the only slide
whose prose pointed at the counter, `enqueue` read 1 and `dequeue` read 3
over three elements — a factor of three that any constant explains as well
as $$N$$ does. Seven of the eight slides that mounted the widget never
referred to it, so there it was chrome that reset silently between runs.

`step.cost` is still computed and still asserted by
`sequenceStepperTrace.test.ts`; what is withdrawn is the claim that painting
it teaches a growth rate. A claim about cost is checked exactly in the trace
test, and taught on the slide by the cost TABLE, which can put two
structures side by side — which is what the unit's format was already for.

Writing that test surfaced something the readout had been covering: the
chain charges exactly `i` for `get-at(i)` while the array charges a flat 1,
so at `i = 0` they read 0 and 1. The two recipes do not count the same unit.
Left as it is and pinned as it is; it mattered less the moment the number
stopped being shown.

**Amended by:** #294, comprehension review (2026-09-20) — **two pictures the
trace was drawing wrong, and a prop to stop the block breathing.**

The array shift emptied the source slot the instant the destination was
written, under a narration that says "Copiamos". A copy does not empty its
source, and what it drew for two frames was a block with a hole in the
middle — the picture #277 teaches as the INVALID array. The source now stays
drawn as `stale`, a state of its own rather than a reuse of `leaving`: one
is an element on its way out of the structure, the other a value nobody will
read again, and painting them alike labelled the leftover copy "sale". This
also fixed the `size` readout, which is derived from the last occupied slot
and so had been dropping two frames early.

`insert-last` narrated "hay que caminar hasta él" whether or not `tail` was
given, because the string branched only on `empty` — on the slide whose
thesis is that `tail` is what avoids walking, and one frame before the
widget's own "tail ya apunta al último: enlazamos sin recorrer nada".

`capacity` is accepted on `dynamic-array` too. The first pass refused it
there, reasoning that the recipe starts FULL so that one insertion shows the
resize — right for one run, and wrong for several, because then the FIRST
push always grows, which is the one place a reader least expects it. An
author running several insertions passes `capacity` to choose which of them
pays. The default is unchanged.

And `capacity` joins the input. Without it the block is sized from the
input, so one structure came out four cells wide on the slide that pushes
and five on the slide that pops. Arrays only; a value below the number of
starting elements is refused at boot like every other authoring mistake.

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
unit — _"sketch the animations the whole unit wants, look for the shared
pattern, and only then decide whether to build, extend or reuse"_ — and names
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
every combination, which is itself the pedagogical message: _the operations
are the same; what changes is where the cost lives._

Five recipes (`array`, `dynamic-array`, `linked-list-singly`,
`linked-list-doubly`, `linked-list-circular`) and nine operations (`get-at`,
`insert-first`, `insert-last`, `insert-at`, `insert-ordered`, `remove-first`,
`remove-last`, `remove-at`, `search`). Thirty-one of the forty-five pairs are
valid. ~~Thirty-eight of the
forty pairs are valid; the two that are not are `insert-ordered` over the two
array recipes~~ — **falsified by this branch's own review; see §Amended by
2026-09-11 (the validity matrix) for the count that ships.** The refusal is a
boot-time `<AuthoringError>` addressed to the author, visible in the suite and
in `/catalog`, never a runtime surprise for a student.

**The widget is three pieces, and two of them are pure.**

- `sequenceStepperTrace.ts` — recipe + operation + input → a frame list and the
  Java listing the frames highlight lines of. No DOM, no React.
- `sequenceStepperLayout.ts` — how many cells → where each box, arrow and
  pointer sits. No DOM, no React.
- `SequenceStepper.tsx` — reads a frame, paints one hand-written SVG from the
  layout, and composes `stepperShell` for playback and chrome.

This is the recipe `apps/web/CLAUDE.md` §2 prescribes for anything jsdom cannot
see: _"the way out is to not measure"_. Geometry the component COMPUTES lives
in a module the suite checks exactly, so no test fakes a measurement — the
failure mode that shipped a false positive as the contract in #103. What is
left for the browser is only whether the drawing reads well.

**Every valid combination is a fixture.** `sequenceStepperTrace.test.ts` sweeps
every pair `isValidCombination` admits, asserting each produces a walkable trace whose highlighted
lines exist in its own listing and whose final frame has settled. A change to
one animation cannot silently break another.

**The playback is the shared one.** `useStepPlayback` from
`stepperShell.tsx` — autoplay off by default (the Peli 1/2 rule), paused when
the widget scrolls out of view, reset on a content change. `<SortStepper>`
still carries its own copy of that machinery (ADR-0065 §Amended by); this
widget is built on the shell instead, which is the direction that ADR's
follow-up points.

**The palette registers the meaning it needed.** The refinement conversation
proposed amber for "new or changed", and amber's nearest EXISTING token was
`flag`, which `design-system.md` reserves for _errors, warnings, diagnostics —
semantic, never decorative_. The first draft therefore used `keep`, and that
was wrong in the other direction: `keep` is success, and a node an insertion
just linked did not succeed, it is simply the one the frame is about.

So a fourth semantic token was registered — `mark` / `mark-soft`, "look here
now" — with its values chosen by measurement and iterated by
`styles/palette.test.ts` (ADR-0026 §Addendum — #288). The widget now uses:
`mark` for a cell just inserted or changed, `keep` for a search hit (which IS
a success, so both tokens ship and they mean different things), `focus` for
the cell under the algorithm's attention — the same token the narration chip
and `<CodeStepper>`'s active line already use — and `accent` for the widget's
own chrome, never for data state. The reference's full coral + emerald + amber
rebrand of the unit remains the separate WP the issue files; this registers
one token with one meaning, not a palette.

**Colour is never the only signal** (`design-system.md` §Rules that are not
about contrast): every painted state also prints a word — `nuevo`, `✓ este`,
`sale` — and every pointer prints its own name (`head`, `tail`, `current`,
`prev`) beside its arrow.

**The identifiers the widget draws are English**, like every listing in the
course: #277 writes `size`, `data`, `StaticArray`, `capacity`. The words the
widget draws come straight out of the listing beside them, so a Spanish
pointer label would have named a variable the code does not have. Only the
narration is Spanish, and where it needs the adjective rather than the
variable it says «el nodo anterior», not `prev`.

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
everything in the render: animating _insert-first over an array_ and
_insert-first over a chain_ share nearly no logic. Grouping by operation hides
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
- **One visual vocabulary.** "Amber (`mark`) is new or just changed, green (`keep`) is the search hit", "focus outline is under
  the algorithm's attention", "the pointer prints its name" hold for arrays and
  for lists alike. The reader learns the code once and reads five structures.
- **The complexity is concentrated.** Thirty-one combinations live in one
  module rather than spread over five. That is a real cost, and it is paid in
  one place with an exhaustive sweep over it.
- **The cost counter is on screen.** Each frame carries a running elementary-
  operation count, so the reader reads $$\Theta(1)$$ against $$\Theta(N)$$ off
  the widget instead of memorising the table — the "show the construction, not
  only the result" rule the widgets of #266 and #268 established.
- **The array recipes ship ahead of their first document.** The comparison act
  of #288 was expected to be two nearly identical tags; it shipped as a static
  cost table and prose, so `array` and `dynamic-array` have a catalog entry, an
  exhaustive trace sweep and no course-document consumer. They are carried for
  the Stack/Queue/Deque class, which mounts the same TDA over both families —
  that class is their first reader, and if it does not use them they should be
  removed rather than re-justified. One asymmetry to close first: the array
  family animates a single run, while the list family takes arrays for every
  argument, so "the same operation over both, side by side" is today two tags
  of different shapes.
- **The next class reuses it.** Stack over a list and Stack over an array are
  two tags of the same widget, so _"same TDA, different implementations"_ reads
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
