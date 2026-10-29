# ADR-0084: `<SequenceStepper>` gains the two hash tables — a contiguous strip with each position's list hanging under its cell, and the keys in the strip itself

**Status:** Accepted — `hash-chaining` (S1, S2) and `hash-probing` (S3) shipped; the professor approved the chaining picture in `/catalog/c/SequenceStepper` and decided the probing listing and picture before they were drawn, his review of the probing recipe in `/catalog` outstanding
**Date:** 2026-10-13
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #326 (Estructuras de Datos Avanzadas · Tablas Hash), slice S1.
**Extends:** ADR-0074 — two recipes, `hash-chaining` and `hash-probing`, with
pictures and operations of their own, the way ADR-0077 added the heap's and ADR-0083 the
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
rule in base 256, reduced modulo `table.length` at every step — exactly as the
JVM computes it: `sequenceStepperHashTrace.test.ts` pins the values against
the output of `eclipse-temurin:21` running that method. The number on the
slide is the number the student's program prints. The base is 256, not the 31
of `String.hashCode()`, because the class builds the hash by reading a key as
a number in base 256 and the listing must be that number; Java's 31 belongs to
a hash that never takes the remainder, and it is explained where
`hashCode()` enters (professor's review, 2026-10-27: a base the slides never
justify is not used). That is the Set and Map class: the act on keys of any
type, with `hashCode` and `equals`, moved there in the review of 2026-10-28,
with Java's own tables.

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

### 4b. `resize`, decided with the professor before it was drawn (S2)

- **The new size is the first prime after twice the old one**
  (`nextPrime(2 * table.length)`), not the double: the class teaches that the
  division method wants a prime `M`, and doubling a prime gives an even
  number. `nextPrime` is plumbing the class writes and says so.
- **`add` resizes when `size == table.length`** — α = 1, one key per
  position on average, which the class's cloakroom tells as one coat per
  locker. Java's 0.75 is a fact the class names, not the rule it writes.
- **`resize` puts every key back in through `add`**: `old = table`, a new
  array, `size = 0`, and a walk over every list of `old` calling
  `add(current.key)`. Moving the same nodes, as Java does, saves the
  allocations and costs the class a listing it cannot read at a glance.
- **The picture draws both arrays**, `old` to the left of `table`, each named
  as the listing names it — `table` alone, then `table` and `old` while both
  name one array, then `old` beside the new `table` — and every key leaves
  its old position (drawn as moved) for the front of its new list, the chip
  reading the new hash and the narration the old one. `size` is the
  listing's field, so the readout falls to 0 and counts back up.
- **A table of at most five positions**: the prime after ten is eleven, the
  most the drawing holds. The class's own example grows from three to seven,
  and the table it leaves is the one its later slides fill.

### 4c. `hash-probing`: the keys in the array, a parallel `deleted` (S3)

Decided with the professor before it was drawn:

- **A removed key is marked in a parallel `boolean[] deleted`**, and stays
  in its cell: `contains` stops at the first null and passes over a mark,
  `add` asks `contains` first and then takes the first cell that is null or
  marked, `remove` sets `deleted[i] = true`. The alternatives: a sentinel
  object compared with `==` — which would use on purpose the `==`/`equals`
  trap the course teaches to avoid — and Sedgewick's reinsertion of the rest
  of the cluster, which the class names and does not write.
- **The picture is the code's state**: `keys` and `deleted` as two
  contiguous strips, one over the other, both named; a marked key struck
  through over `true`. The cursor `i` walks under them, and the chip over
  the cell the hash named reads `hash("Eva") = 5`, as on the chaining table.
- **At most half the cells are used, marks included** (the professor's
  review, #326 S10b — the first version kept only "one cell empty", and its
  class never resized, so a table filled by `add` sent the search of a
  missing key into an endless loop). The invariant — between the position a
  key hashes to and the cell it sits in there is no empty cell — is what lets
  a search stop at the first null, and a null has to be there to stop at. The
  class keeps a counter `used`, the cells that are not null, and its `add`
  resizes when the new key would use more than half of them:
  `if (2 * (used + 1) > keys.length) resize(nextPrime(2 * keys.length));`,
  with a `resize` that puts back only the unmarked keys. The widget walks
  that line and `if (keys[i] == null) used++;`, shows `used` under `size`,
  and refuses a starting table past the half and an insertion that would
  resize — it does not draw this table's resize, which the class shows as
  code.
- **A slide may start from marks** (`deleted={['Bea']}`): the act needs a
  search that passes over one and an insertion that reuses one.
- The class's example is eleven positions where Ana and Bea collide at 5,
  Olga sits at 10 and Iván wraps from 10 to 0; Luz, absent, hashes to 5, and
  Eva enters at 7 — four used cells, so one insertion still leaves the table
  at most half full. Every value pinned against the JVM. (The first example
  had Leo at 4 and Tomas wrapping; five used cells left no room for an
  insertion under the half rule.)

### 5. The operations, in the order the class needs them

- **S1:** `search`, `insert`, `remove` on `hash-chaining` — the listings
  `contains`, `add` and `remove` the class writes.
- **S2:** `resize` on `hash-chaining` — the method `add` calls when the table
  is full (§4b).
- **S3:** `hash-probing` × {`search`, `insert`, `remove`} — the class's
  `contains`, `add` and `remove` over `keys` and `deleted` (§4c).

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

- The validity matrix grows two rows: `hash-chaining` × {`search`,
  `insert`, `remove`, `resize`} and `hash-probing` × {`search`, `insert`,
  `remove`}; `resize` is valid on `hash-chaining` only, and `remove` on the
  two hash tables and the search trees (`add-a-course-document.md` §5h
  carries it).
- `SequenceStep` gains `hash` (the table, the listing's `size`, and during
  `resize` the old table); `SequenceTrace` gains `hash` (positions, the
  longest list any frame holds and, for `resize`, the old positions, so the
  canvas keeps one size);
  `SequenceStep` and `SequenceTrace` also gain `probe` (`keys` and `deleted`
  cell by cell, the hash's cell, the cursor, the listing's `size`; and the
  positions); `SequenceInput` gains `keys`, `key` and `deleted`; the
  component's `value` and `target` accept text, and it gains `deleted`. The
  other recipes never set them.
- **The picture exists only in a real browser.** The frames, the hashes and
  the geometry are pinned exactly (`sequenceStepperHashTrace.test.ts`,
  `sequenceStepperProbeTrace.test.ts`, `sequenceStepperHashLayout.test.ts`), and the component test pins which
  positions, nodes, links and references are drawn; the paint is checked in
  the browser, in both themes.
