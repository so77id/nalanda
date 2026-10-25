# ADR-0084: `<SequenceStepper>` gains a hash table — a contiguous strip with each position's list hanging under its cell

**Status:** Proposed — `hash-chaining` (`search`, `insert`, `remove`) shipped and its picture approved by the professor in `/catalog/c/SequenceStepper` (S1); the redimension (S2) and the open-addressing recipe (S3) close it
**Date:** 2026-10-13
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #326 (Estructuras de Datos Avanzadas · Tablas Hash), slice S1.
**Extends:** ADR-0074 — a recipe, `hash-chaining`, with a picture and
operations of its own, the way ADR-0077 added the heap's and ADR-0083 the
tree's. Both still hold entirely; nothing in ADR-0074 is amended.

## Context

Tablas Hash is the seventh class of the unit, and its two structures are a
hash table that resolves collisions with a list per position (chaining) and
one that keeps every key in the array itself (linear probing). What the class
teaches is where a key goes: the hash names one position, and the operation
looks THERE and nowhere else. That is a listing with a lit line over a
structure, which is what `<SequenceStepper>` does, and
`teach-a-data-structure.md` §7 says a class of the unit that needs a structure
the widget does not draw adds a RECIPE to it, with an ADR, rather than a widget
of its own. The issue decided as much in its refinement (2026-10-13): two
recipes, `hash-chaining` and `hash-probing`, no new widget.

## Decision

### 1. `hash-chaining` is a recipe of `<SequenceStepper>`

Same props, same chrome, same frame model plus one optional field,
`step.hash`: the list of every position, the key the run works with, the
position its hash named (null until the line that computes it runs), the
references the listing holds (`current`, `prev`), and — for the frames that
need them — the node `add` builds apart and the link `remove` draws past a
leaving node. The trace lives in its own pure module
(`sequenceStepperHashTrace.ts`), dispatched from `traceFor` and importing only
types from the dispatcher (ADR-0083 §1's rule against a runtime cycle); the
geometry in `sequenceStepperHashLayout.ts` and the painter in
`sequenceStepperHashView.tsx`, as the heap's and the tree's do.

### 2. Keys are text, and the hash is the class's own

The class's table holds `String`s — a set of names in the cloakroom of its
running thread — so `values` on `hash-chaining` is the keys already in the
table, added in order, each at the front of the list of its position, and the
key an operation works with is `target` (`search`, `remove`) or `value`
(`insert`), as on every recipe. A number where a key goes is refused, and so
is text on any other recipe.

The position drawn is computed by the class's `hash(String key)` — Horner's
rule with 31, reduced modulo `table.length` at every step — exactly as the
JVM computes it: `sequenceStepperHashTrace.test.ts` pins the values against
the output of `eclipse-temurin:21` running that method. The number on the
slide is the number the student's program prints.

### 3. `table` is a contiguous strip; the lists hang under it

`table` is drawn as the unit draws every array — a horizontal strip with its
index — and its cells TOUCH: an array is contiguous memory, the invariant the
unit teaches first, and the professor's review of the first prototype
(2026-10-13) rejected cells with gaps between them, which read as loose boxes
the way nodes do. The list of each position hangs DOWN from its cell, one node
under the other, so the table stays one strip wide however long a list grows,
and `hash-probing` (S3) will draw the same strip with the keys inside it.
Hanging rather than running sideways is the one departure from the textbook
picture (an array drawn vertically, lists to the right), taken for that
reason.

### 4. What the picture shows, decided with the professor

- **The hash, before anything else.** A frame of its own lights the line that
  computes it; from then on a chip over the position reads
  `hash("Ana") = 4` and the position is outlined. Before it, the chip holds
  the key alone.
- **`add` asks `contains` first and puts the node at the front.** The walk
  `contains` makes is drawn while the one line `if (contains(key))` stays lit
  — the class's `add` calls it, so the widget shows no second listing. The
  new node is built in the band over its position, where the key was: the key
  and the node it becomes occupy one place. `fresh.next = table[i]` runs down
  the right of the column to the old first node, `table[i] = fresh` points UP
  at the node, and only `size++` drops it into its list — the assignment
  before the move, the rule the list recipes keep.
- **`remove` treats the first node apart and walks the rest with `prev`**,
  with no node of its own in front of the list (the course's lists never use
  one). The link that skips the leaving node runs down the right of its
  column, and the node is dashed and struck through until `size--` takes it
  away.
- **The references the listing holds are named** over the top-left corner of
  the node they point at, in the gap between rows, so a name never reaches the
  next column.
- **`size` is on screen**: the class's table has a `size` field, as the chains
  do.
- **Operations keep one name per idea across recipes**: `search` and
  `insert` as on the chains, the heap and the trees, and `remove` as on the
  search trees (#322), which took the name first.
- **Two to eleven positions**; the drawing stops being legible on a slide past
  that.

### 5. The operations, in the order the class needs them

- **S1:** `search`, `insert`, `remove` on `hash-chaining` — the listings
  `contains`, `add` and `remove` the class writes.
- **S2:** the redimension, a new table and every key reinserted.
- **S3:** `hash-probing`, the keys in the array itself, with a mark where a
  key was removed.

None ships without a slide that mounts it (#296, ADR-0077 §5).

## Alternatives considered

- **A `<HashStepper>` widget of its own.** Refused for the reason ADR-0077 and
  ADR-0083 refused theirs: a second surface for the same kind of animation,
  every guard re-earned.
- **The textbook picture: `table` vertical, lists running right.** Legible,
  but the array would stop looking like every other array of the unit, and
  the probing recipe, which needs a strip, would draw the same `table` a
  second way.
- **Cells with gaps between them, as the first prototype drew them.**
  Rejected by the professor: it contradicts the contiguity the class has
  already taught.
- **`add` with the walk written inline.** It would light every comparison in
  `add`'s own listing, but the class writes `add` over `contains`, and the
  widget shows the class's code.

## Consequences

- The validity matrix grows one row: `hash-chaining` × {`search`, `insert`,
  `remove`}; `remove` is valid on nothing else
  (`add-a-course-document.md` §5h carries it).
- `SequenceStep` gains `hash`; `SequenceTrace` gains `hash` (positions and the
  longest list any frame holds, so the canvas keeps one size);
  `SequenceInput` gains `keys` and `key`; the component's `value` and `target`
  accept text. The other recipes never set them.
- **The picture exists only in a real browser.** The frames, the hashes and
  the geometry are pinned exactly (`sequenceStepperHashTrace.test.ts`,
  `sequenceStepperHashLayout.test.ts`), and the component test pins which
  positions, nodes, links and references are drawn; the paint is checked in
  the browser, in both themes.
