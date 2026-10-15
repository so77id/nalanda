# ADR-0086: `<SequenceStepper>` gains the AVL tree — the rotation one assignment at a time, the rebalancing on the way back

**Status:** Accepted
**Date:** 2026-10-15
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #322 (Estructuras de Datos Avanzadas · Árboles II). Written
during the branch as §6 of ADR-0083 and moved here by #322's review: a new
recipe on an existing widget is an ADR that `Extends:` it
(`documentation.md` §ADR format), and the section had left ADR-0083 holding an
Accepted "cap stays at eight" and a Proposed "twelve" in one file.
**Extends:** ADR-0083 — a third tree recipe, `avl`, built on the binary tree's
pieces: the four rotations walked an assignment at a time, and `insert` and
`remove` rebalancing on the way back. ADR-0083 still holds entirely but for
its cap of eight, which names this recipe's exception in place (§5 there,
`Amended by: #322`). Through ADR-0083 it also extends ADR-0074, whose palette
paragraph names the accent data state this recipe and the search tree's
removal use (`Amended by: #322` there).

## Context

Árboles II teaches the rotation as a tool before the AVL tree that uses it,
then the AVL as the search tree that keeps its height logarithmic. Both are a
listing with a lit line over linked nodes, which `<SequenceStepper>` already
draws for the binary tree and the search tree (ADR-0083). The design was done
with the professor on the running widget, slide by slide (#322's review), and
every decision below records what that review asked for.

## Decision

### 1. `avl` is a recipe of `<SequenceStepper>`, with a trace of its own

`rotate-right` and `rotate-left` (`target`, the node that rotates), the
doubles `rotate-left-right` and `rotate-right-left`, and `insert` and
`remove`. The four rotations are valid on no other recipe. The trace is a
module of its own, `sequenceStepperAvlTrace.ts`, built on the pieces
`sequenceStepperTreeTrace.ts` exports (the node, the recorder, the search
tree built by inserting, the run's columns). Like the tree's, it imports only
types from the dispatcher, so the dispatcher's value import of `traceAvl`
closes no runtime cycle (ADR-0083 §1).

### 2. The rotations

- **`values` builds a PLAIN search tree** for the rotations, inserted in that
  order with no rebalancing: the act shows rotating a tree that leans, before
  anything says when to rotate.
- **One frame per assignment**, the rule StepShow follows (Miguel, #209):
  `q = p.left`, `p.left = q.right`, `q.right = p`, `return q`. The listing is
  the class's method before the AVL gives its nodes a height.
- **Every node holds its level until the caller takes `q`.** Between the
  second assignment and the return the structure is not a tree — a subtree
  with two parents, then `q` pointing back up at `p` while nobody points at
  `q` — and drawing it as it is IS the lesson: the method changes links, not
  places. Recomputing the levels at every frame would make the nodes jump
  while the code moves nothing. The recorder gained `loose` (nodes only a
  local variable holds, drawn anyway) and `frozen` (levels kept from the
  last frame) for this.
- **A reference that does not point down gets an arrowhead.** An edge is
  read parent above child; `q.right = p` with `q` below would read as the
  opposite link.
- **The strip keeps one inorder through every frame** — the claim the act
  makes, drawn instead of asserted. The columns are the values' ranks, as on
  `bst`, so in the frame where the tree settles the nodes only move up or
  down. The narration's «El inorden sigue siendo …» is read from the links
  after the return, not from the strip, which writes each value in its own
  column and would read sorted whatever the links were (#322 review).
- **`p` and `q` are written beside their nodes**, the listing's names, and
  the two nodes paint in `accent`, the unit's "being moved" token; the
  subtree that changes parent paints in `mark`. Colour is never the only
  signal: the badges and the narration name all three. This is a data state
  in `accent`, the exception ADR-0074's palette paragraph names.
- **The double rotations are operations of their own** (Miguel's review: the
  doubles taught with the same script as the simple ones, definition, order,
  code and widget, before the AVL says when to use them). Their listing is a
  method of two calls — `p.left = rotateLeft(p.left); return rotateRight(p);`
  and its mirror — and the AVL's `balance` calls `rotateLeftRight` and
  `rotateRightLeft` instead of writing the two calls inline with a comment.
  The two simple rotations are listed side by side under it (`callees` on
  the trace, the lines each frame lights in them in `calleeLines`), and each
  call is walked inside its own listing an assignment at a time, the call lit
  above the whole time, levels held as the simple rotation's widget holds
  them. A first version gave each call one frame; Miguel's review: "the
  steps get lost". The names on the drawing are the running method's —
  inside `rotateLeft(p.left)`, its `p` is the outer `q`.
- **A rotation's example leans** (Miguel's review: "the tree comes out like
  a mirror"): every slide rotates a tree whose height the rotation lowers,
  and the last frame says so.

### 3. `insert` and `remove`

- **Listed as the search tree lists them**, the public method over the
  private one, the first frame lighting the public call, with
  `return balance(node)` as the private one's last line — the script every
  operation of the class follows (Miguel's review of the AVL section).
- **Their `values` build a real AVL**, rotating as it goes with no frames,
  because a slide that inserts into an AVL starts from one.
- **The balance factor is a badge on every node**, `+1`, `0`, `−2`, read off
  the heights the nodes STORE, as `balance` reads them. A factor above the
  node being balanced may therefore still be the old one, and changes when
  the walk back reaches it: that is when the code learns it. Computing the
  true factor everywhere would show a `−2` the code has not found yet. A
  height in the narration is a number — «su factor es 0 − 2 = −2» — and the
  empty tree's is −1 with a true minus.
- **Every node of the way back gets its `balance` frame**, with its height
  and factor narrated; the rotation inside is one frame (a double, two) —
  the rotation act already walked its assignments. The caller's assignment
  is made at once, so the drawing never shows a tree the code no longer
  holds.
- **`balance` is listed beside them.** `insert` first showed the `balance`
  it calls under it, thirty-two lines, and its slide measured 0.545 against
  the 0.70 floor. Side by side the height is the taller listing's, not the
  sum: the trace carries a `row` of listings, each lit on its own
  (`rowLines`), and every frame of the walk back lights in `balance` what it
  does — its height and factor, the branch of the loaded side, the child's
  factor, the rotation it returns (Miguel's review: "put balance sharing the
  space with the insertion"). Its two double returns go on a line of their
  own so a program, a method and `balance` fit three abreast — a fifth and
  two fifths each, two listings in halves (Miguel's widths). `remove` lists
  the search tree's lines without their comments, which do not fit two
  fifths of a slide. The class also puts `balance` on a slide of its own, as
  a fence, with the same lines.
- **Both run as a program**, the way `bst`'s removals do: the program beside
  the method and `balance`, the method walked for every call with the
  program's line lit. A first version drew each insertion as one or two
  frames with no method; Miguel's review put the single insertion and its
  code first, then the run with the code beside it, step by step. The class's
  run of removals is the cascade's twelve-node tree, built by inserting its
  level order, and its four removals go through a rotation at two levels, no
  rotation, the simple rotation a child at 0 asks for, and a double.
- **The successor of a removal is named.** Before the copy it paints in
  `accent`, the colour the rotations use later in the same walk, so it
  carries the badge «sucesor» for that frame and the legend reads «sucesor o
  rotan» (#322 review: the class's first removal, of a root with two
  children, showed its successor under a legend that said «rotan»).

### 4. The cascade in the widget: twelve nodes on an AVL

A removal that rotates at two levels needs a tree of height 4 at least — the
first rotation needs a node of height 2, the second an ancestor two levels
above it — and the smallest AVL tree of height 4 has twelve nodes
(N(h) = N(h − 1) + N(h − 2) + 1). The cap was eight for every recipe, and the
class first drew the cascade with `<BinaryPicture>` only. Asked to run it in
the widget (Miguel's review: "show the case of the cascade slide, then other
removals"), the cap is twelve for `avl` × `insert` and `remove`, which build
a real AVL — at most four levels with twelve nodes — and stays eight
everywhere else: a search tree of twelve, the rotations' plain tree included,
can be a chain eleven deep. A single `value` counts as one toward the cap, as
a list of one does (#322 review). The bar for the next exception, written at
the rule's home (ADR-0083 §5): a recipe whose own invariant bounds the drawn
height at that size, with the slide measured.

## Alternatives considered

- **A section of ADR-0083.** How this was first written; it left one file
  holding an Accepted "eight" and a Proposed "twelve", and a status spelling
  the format does not have (#322 review).
- **An `<AvlStepper>` of its own.** Refused for the reason ADR-0077 refused
  `<HeapViz>` and ADR-0083 `<TreeStepper>`: a second surface for the same
  kind of animation.
- **The rotation as one frame.** The first draft; the professor asked for
  the assignments, because a rotation is three reference changes and the
  lesson is that each one keeps the order.
- **True factors on every node.** See §3: it shows what the code has not
  found yet.

## Consequences

- The validity matrix grows a row, `avl` × {`rotate-right`, `rotate-left`,
  `rotate-left-right`, `rotate-right-left`, `insert`, `remove`}
  (`add-a-course-document.md` §5h carries it); `remove` is the search
  trees' operation, valid on `bst` and `avl` both.
- `SequenceTrace` gains `callees` and `row`, and `SequenceStep`
  `calleeLines` and `rowLines`; `SequenceInput`'s `program` is valid on
  `avl` × `insert` and `remove` as on `bst` (ADR-0074, `Amended by: #322`,
  records the code panel holding several named listings).
- `MAX_AVL_VALUES = 12` beside `MAX_VALUES = 8` in `SequenceStepper.tsx`.
- **The picture exists only in a real browser.** The frames are pinned
  exactly (`sequenceStepperAvlTrace.test.ts`; #322's review also ran the
  trace against an independent AVL model, thousands of random runs, in a
  probe it did not commit), and every combination
  Árboles II mounts is pinned and stepped to its last frame in
  `SequenceStepper.test.tsx`; the paint is checked in a browser, in both
  themes.
