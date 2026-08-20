# ADR-0043: The memory diagram consumes author-written state, drawn beside code by a generic stepper

**Status:** Accepted
**Date:** 2026-08-19
**Decision-makers:** Miguel Rodriguez
**Covers:** `<StepShow>` + `<Step>` + `<CodeStepper>` as the generic "code
stepper two-side" primitive · `<MemoryVisual state={…}>` as one concrete
consumer of it · the removal of the `library` compilation unit, the
`NalandaTrace` reserved name and the `trace.ts` runtime dependency
**Source:** Issue #209, chat design 2026-08-20 (Miguel).
**Supersedes:** ADR-0028 (execution-trace memory diagram). Extends
ADR-0010/0014 (component contract and catalog); relies on ADR-0026 (the
diagram draws its own listing) and stays constrained by ADR-0018 (what may
reach the entry chunk). Absorbs the follow-up issues #181 (precompute trace
at build time) and #182 (shared `<Listing>` primitive inside the diagram),
both closed with reason.

## Context

ADR-0028 chose to draw the memory diagram from an execution trace: a
`NalandaTrace` class compiled beside the snippet, run in the browser,
photographed the named variables at author-marked lines, and printed the heap
back for the component to read. It bought one thing that mattered — **the
drawing cannot lie about what the code does** — at a cost that turned out to
be more than the pedagogy needed.

The cost, measured in production (documents 2 and 3 shipped, #77 and #78):

- **A Java compile and a JVM per diagram.** Every diagram mounts pulls the
  runtime seam and, on first Run, downloads CheerpJ; every Run compiles both
  the snippet and the tracer beside it. The mounted-diagram cost after #122
  moved grammars out of the runtime module was **33.95 kB raw / 13.12 kB
  gzip across four lazy chunks** (ADR-0028 §9), plus whatever the reader
  waits for CheerpJ.
- **A runtime contract that grew for one widget.** `library` on
  `RunRequest`, a reserved name (`NalandaTrace`) alongside `NalandaLauncher`
  and `NalandaCheck`, a bypass on the reserved-name guard for that field,
  and — in `instrument()` — a nested-`NalandaTrace` foot-gun the guard could
  not see and had to be dispositioned separately (`security-notes.md`, #123).
  All of it existed for one component.
- **Author-time surface stapled to a fence.** The `trace` fence and its
  `// foto` markers are a small language of their own (ADR-0028 §2). It
  worked, but it is a shape only one widget uses, and only Java understands.

What the trace bought — the picture cannot drift from the code — was
worth a lot in principle and less in practice at the volumes this repo has:
two hand-written diagrams in doc 2, iterated visually with Miguel before
shipping. A build gate over hand-written state cannot exist (ADR-0028
§Context recorded this about authored drawings — it is what motivated the
trace in the first place). But author judgement can, and does; the shape of
the doc 2 diagrams is what a professor picks the four moments and four
names FOR, and none of those moments were ever a surprise the JVM was
producing behind the author's back.

**The pattern is more general than "memory".** Everything doc 2 wanted from
the tracer — code on one side, a picture on the other, both walked in sync
by prev/next — is the same shape a call stack, a tree, a hash table or a
sequence diagram wants. Nalanda had no primitive for that sync; each
hypothetical widget would have rebuilt one, and each would have paid its own
runtime tax to keep the picture true. Building the sync AS the primitive
retires the widget-specific cost and unlocks the future ones by handing
them one seam to plug into.

Before committing, alternatives were investigated (2026-08-20, with Miguel):

- **Precompute the trace at build time** (#181) would keep the guarantee at
  zero runtime cost, but pushes CheerpJ into the build and preserves the
  fence-with-markers surface. The pedagogy question — is the guarantee worth
  the surface — is the same one that was reopening; closing it "run traces
  at build" answers the wrong question.
- **A memory-diagram DSL** (author writes a compact list of aliases and
  fields, the widget interprets it) trades one small language for another
  and offers nothing the widget's JSX prop shape does not.
- **A third-party library** (Python Tutor's renderer, React Flow, Mermaid
  for memory) was surveyed. None fits Nalanda's stack cleanly enough to
  justify replacing `memoryLayout.ts` — the algorithm that gives the diagram
  its convention (arrows on the right, cross-frame aliasing named in the
  description). Mermaid stays available as a general-purpose diagramming
  component (ADR-0040) for other visuals an author might drop into a
  `<Step>`.

## Decision

**1. The primitive is a generic pair, not a memory-specific widget.**
`<StepShow>` owns a step index; `<Step lines={number[]}>{JSX}</Step>`
declares each step's line highlight and its visual. Any JSX goes on the
visual side — a `<MemoryVisual>`, a future `<CallStack>`, a tree, a
`<Mermaid>` sequence diagram, an image. The code side is a plain
listing with per-line highlight, rendered by an internal `<CodeStepper>`.
Two `<StepShow>`s on one page step independently.

The "code stepper two-side" pattern is what carries forward from ADR-0028
(the fence-with-markers surface is what does not). #182's shared `<Listing>`
primitive is absorbed into `<CodeStepper>` — the two problems it was
splitting are one.

**2. `<MemoryVisual>` is one concrete consumer of that primitive.** It takes
a typed state:

```ts
interface MemoryState {
  frames: MemoryFrame[]; // stack: name + variables
  objects: MemoryObject[]; // heap: object / string / array + fields
}
```

References are values (`{ kind: 'ref', id: N }`) rather than a top-level
`refs` list, so the author writes what a variable HOLDS at each step
directly. The drawing algorithm is `memoryLayout.ts` unchanged — its
convention (arrows on the right, cross-frame aliasing named in the
description) is what the course reader has learned to read.

**3. The listing is not syntax-coloured.** `<CodeStepper>` renders plain
monospace text with per-line highlight, not through `<CodeEditor>`. The
weight argument ADR-0028 §Consequences settled after #122 stands intact:
adding an editor would cost the CodeMirror core AND a grammar for a
highlight that is a per-line box, not tokenised colour. The whole reversal
here goes for **less bundle**, not more; the browser check confirms the
lines light in both themes.

**4. Navigation is prev / next / reset, and only that.** Click-line-to-jump
is a documented follow-up idea, not shipped. Same rationale as ADR-0028's
line-highlight-belongs-to-the-player: the value is small, the code lives
in one place, and the author picks the step order deliberately.

**5. Highlight granularity is line-based only.** `lines={[1, 3]}` lights
lines 1 and 3. Named-block granularity is a follow-up when a step's lesson
covers something like "the whole `swap` body" and picking two-line ranges
becomes noise; there is no such lesson today.

**6. The runtime contract shrinks.** `library` leaves `RunRequest`;
`NalandaTrace` leaves `RESERVED_CLASSES`; `trace.ts` and `MemoryPlayer.tsx`
are deleted, and with them the tracer class the ADR-0028 §Decision-1
generated. `rejectHarness` still covers the SHAPE of a second unit alongside
`source`, so a future addition is caught by construction rather than by
memory. The `loadRuntime` / `loadGrammar` split introduced by #122 stays
useful — for the next non-editor consumer of the runtime, if one arrives.

**7. Author judgement replaces the JVM as the truth-preserving mechanism,
and this is stated plainly.** The picture cannot drift from the code the
way an authored figure could in the pre-ADR-0028 world; nothing about the
new shape brings back a build gate. The author writing a `<MemoryVisual>`
beside a snippet is responsible for the picture being TRUE, and iterates
the states visually before publishing. That is the trade this ADR makes;
ADR-0028 §Context is the historical record of why the alternative was
rejected then, and re-reading it beside this decision is the point of
preserving 0028's body.

**8. `NalandaTrace` unreserves.** The name was reserved (#116, #123)
specifically to stop student code shadowing the platform's tracer class.
The class no longer exists, and no other subsystem uses that name. The
other two reserved names — `NalandaLauncher` (the run harness) and
`NalandaCheck` (the exercise harness) — stay reserved because those units
still ship.

## Alternatives considered

**Keep the tracer, precompute at build time (#181).** Trades runtime cost
for build cost and preserves the whole fence-with-markers surface. Rejected:
the pedagogy question — is the JVM's guarantee worth the surface — is what
was reopening, and precomputing answers a different question.

**Keep the tracer, live.** The status quo of ADR-0028. Rejected on measured
cost against a shipped consumer (`#77`): every reader of doc 2 downloads
four chunks + CheerpJ + tracer compile per Run, for a picture the author
had already decided the shape of. The pedagogy gain is small at the
volumes here — hand-written states get one visual review round with the
professor and ship. Two mounted diagrams per doc, one doc today, six in
the roadmap.

**Adopt a memory-diagram DSL.** Author writes something like
`{ frames: {main: { a: -> 1, b: -> 1 }}, objects: { 1: Punto{x:1, y:2} } }`
and the widget parses it. Rejected: it swaps one small language
(fence + markers) for another (DSL) and offers nothing the JSX prop shape
does not. Plain JSX also carries the same typing every other component
does, without a parser to maintain.

**Adopt Python Tutor's renderer, React Flow, or Mermaid for memory.**
Investigated. Python Tutor's renderer is coupled to its trace format and
would drag its data pipeline with it. React Flow is a graph-editing
library, not a memory-drawing one — the trade of `memoryLayout.ts` for
React Flow's node/edge model is a loss of the convention the course teaches.
Mermaid can draw class diagrams (ADR-0040) and sequence diagrams and
belongs in an author's toolbox (a `<Mermaid>` inside a `<Step>` is a
legitimate pattern), but has no shape that matches memory boxes with named
fields and cross-frame aliasing arrows. Preserving `memoryLayout.ts` is
the cheaper, less-lossy path.

**Compute `changed` automatically from adjacent `<Step>`s.** Tempting: the
tracer used to compare shapes and paint the changed boxes with a stronger
stroke. Deferred: it needs a shape-diffing pass over hand-written state,
and the doc 2 examples only need `changed` on one step (the mutation).
The prop stays on `<MemoryVisual>` for author use, and future automation
is additive.

**Bring `<Step>` under a `steps` prop instead of a marker child.**
`<StepShow steps={[{lines: [1], visual: <MemoryVisual …/>}, …]}>` is more
constrained but forces the author to write JSX in an array. Marker children
compose better with MDX and match the shape `<Question>` / `<Questions>` use
elsewhere in the repo. Rejected on ergonomics.

## Consequences

- **Bundle down for the diagram-bearing page.** The trace chunk vanishes;
  the tracer Java class vanishes with it; the `<MemoryDiagram>` lazy chunk
  is gone. `<StepShow>` ships behind `LazyStepShow` (its `<CodeStepper>`
  imports CodeMirror + `useGrammar` to give the listing the same syntax
  colour every other `java` fence on the site gets since #85, so the widget
  must not reach the entry chunk — architecture guard at
  `src/architecture.test.ts` §"the step-through widget stays out of the
  entry chunk"). `<Step>` and `<MemoryVisual>` stay eager: `<Step>` is a
  null marker, and `<MemoryVisual>` imports only pure code (`memoryModel`,
  `memoryLayout`, `<AuthoringError>`) — no CodeMirror, no runtime seam.
  Measured on the shipped build (baseline `main` vs. branch,
  `npm run build`): entry chunk +1 965 B gz (~+1.2%, mostly the eager
  MemoryVisual + memoryLayout code); new StepShow lazy chunk +2 087 B gz
  (loaded only by pages that mount one); doc-2 chunk +298 B gz for the
  hand-written states; MemoryDiagram lazy chunk −7 266 B gz. Net for a
  doc-2 reader: **−2 777 B gz (≈−1.6%)**. Non-diagram-page readers pay
  the +1 965 B eager cost. Making `<MemoryVisual>` lazy too would flatten
  that further; a follow-up WP can do it, and this ADR pins the current
  three-way split (StepShow lazy, MemoryVisual eager, Step marker eager).
  AC-9 pins verification with `npm run build` + grep of the bundle.
- **The truth-preserving job moves to the author.** Miguel iterates the doc
  2 states visually at 1440px in both themes before merging, and expects
  a post-PR round of visual edits. This is the first time the pictures ship
  without a JVM to make them true, and that responsibility is 100% the
  author's from now on. `guides/add-a-course-document.md` §5d writes this
  in full for future authors.
- **A visual widget consuming author state MUST preflight-check for
  structural hazards that would silently draw a wrong picture.** VISUAL
  fidelity to the code stays the author's judgement per §Decision-7. But
  structural mistakes the tracer prevented by construction — a duplicate
  object id, a `ref` pointing at an object the state doesn't declare — are
  cheap for the widget to catch, and a wrong picture drawn silently is
  exactly the failure mode §Decision-7 asks the author to guard against.
  `<MemoryVisual>` refuses both cases before rendering, returning an
  `<AuthoringError>` naming the frame/field. The future
  `<CallStack>` / `<TreeVisual>` / `<HashTableVisual>` / `<QueueVisual>`
  the next bullet anticipates each carry their own class of such hazard
  (an activation id referenced by no frame, a tree child pointing at a
  non-existent node id, a bucket entry with a key that hashes elsewhere):
  the rule for each is the same preflight-and-refuse shape, using the
  shared `<AuthoringError>` seam.
- **Other visual widgets plug in.** The next `<CallStack>`, `<TreeVisual>`,
  `<HashTableVisual>`, `<QueueVisual>` inherits step navigation and code
  synchronisation for free — the follow-up WPs that build them exercise
  the `<StepShow>` contract without rebuilding it.
- **Recursion is still not drawable by frame name alone.** ADR-0028's
  §Consequences noted that frames keyed by name collapse N recursive
  activations into one. That constraint is preserved here — an author who
  writes `swap` twice with different variables gets two frames on screen at
  once, because they are naming the activation. A dedicated call-stack
  visualiser is Discussion #49 and inherits `<StepShow>`; it needs a frame
  identity that names activations, not method names, which is why it is a
  separate WP.
- **`NalandaTrace` is a normal identifier again.** A snippet may declare a
  class of that name; a nested one is fine too. The runtime and catalog
  notes on `<CodeEditor>`, `<PredictOutput>` and `<Exercise>` are updated
  to name only the two surviving reserved classes. The security-notes
  disposition on the third reserved name is preserved as historical record
  with a "RETIRED in #209" header.
- **The two follow-up issues close by construction.** #181 (precompute the
  trace) — the trace no longer exists, so there is nothing to precompute.
  #182 (shared `<Listing>` primitive inside the diagram) — the shared
  primitive is `<CodeStepper>`, part of this decision. Both close with
  reason and a reference to #209.
- **ADR-0018 and ADR-0040 gain amendment headers.** Both cited
  `<MemoryDiagram>` as a worked example (non-editor runtime consumer;
  peer content-component pattern). The examples are historical now; the
  reasoning both ADRs carry stays intact.

## Not yet proven

- **The bundle metric before and after.** Expected DOWN, pinned by AC-9; the
  PR body carries the measurement so a review can dispute it.
- **The doc 2 states.** Written with Miguel's best pedagogical judgement
  and will be reviewed visually at 1440px in both themes post-PR. At least
  one round of visual edits is anticipated — this is a design surface, not
  a compile-checked artifact.
- **The `<StepShow>` contract at scale.** One consumer (`<MemoryVisual>`)
  today. The first follow-up widget to land after this WP validates the
  contract in practice; if it needs a shape this decision did not
  anticipate, this ADR gets an amendment naming what changed and why.
