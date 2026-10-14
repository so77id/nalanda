# ADR-0083: `<SequenceStepper>` gains a linked binary tree — every node in the column of its inorder position

**Status:** Accepted — the professor's review of the recipe in `/catalog/c/SequenceStepper` outstanding; §6, the `avl` amendment (#322), Proposed
**Date:** 2026-10-11
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #321 (Estructuras de Datos Avanzadas · Árboles I), slice S2.
**Extends:** ADR-0074 — a recipe, `binary-tree`, with operations and a
picture of its own, the way ADR-0077 added the heap's. ADR-0077 still holds
entirely, and so does ADR-0074 but for the `size` readout, which the tree does
not show (`Amended by: #321` there).
**Amended by:** #322 (Árboles II): the `bst` recipe ships with the class
that mounts it (§2, §3, §5), and a third recipe, `avl`, rotates, inserts
and removes (§6).

## Context

Árboles I is the first class of the Estructuras de Datos Avanzadas unit, and
the first that needs a tree made of NODES — `left`, `right`, a root — rather
than an array read as a tree. Its operations are recursive, and what the class
teaches is which line of the method is running at which node: the three
traversals differ only in where the visit sits among the two calls. That is a
listing with a lit line over a structure, which is what `<SequenceStepper>`
does.

`teach-a-data-structure.md` §7 says a class of the unit that needs a structure
the widget does not draw adds a RECIPE to it, with an ADR, rather than a widget
of its own. The issue's earlier draft proposed a separate `<TreeStepper>`; the
professor refused it in the refinement of 2026-10-11, and refused reusing
`heap-max` too, because the heap draws an array and this class needs linked
nodes.

## Decision

### 1. `binary-tree` is a recipe of `<SequenceStepper>`

Same props, same chrome (listing on top, structure, narration strip,
controls, speed), same frame model plus one optional field, `step.tree`: every
node with its two links and its paint, the calls still open, and a strip. The
trace lives in its own pure module (`sequenceStepperTreeTrace.ts`), dispatched
from `traceFor`, because the sequence module was already 2400 lines; the
geometry lives in `sequenceStepperTreeLayout.ts` and the painter in
`sequenceStepperTreeView.tsx`, as the heap's do (ADR-0077 §1). What the two
trace modules share — the line a frame lights, the runs an argument asks for —
is a leaf both import, `sequenceStepperTraceShared.ts`, and the rim-to-rim
edge the two layouts share is another, `sequenceStepperEdge.ts` (#321
review). The heap's layout and the tree's import only that leaf. The two traces do import
each other, but the tree's imports only types from the dispatcher, which the
build erases, so no runtime cycle closes; nothing guards that, so a value
import back from the dispatcher is the change to refuse.

### 2. Every node sits in the column of its inorder position

A node's x is its inorder position and its y its depth. A parent therefore
always sits between its two subtrees and no edge crosses another. Under the
tree, a strip has one slot per column, and a traversal writes its output into
it left to right. The inorder lands under its own nodes; the preorder and
postorder visibly do not. A search tree's operations draw no strip (#322,
Miguel's review): under an insertion it read as an array the tree keeps, and
a search tree keeps none. The sorted inorder is shown where it is the
lesson — the traversal's own slide — and the rotations keep their strip,
because what they teach is that the inorder does not change.

The columns are fixed for the WHOLE run — every node the run ever holds is
placed once — so an insertion (`bst`) lands in a column already reserved and
nothing on screen moves: the rule `maxCells` keeps for the chains.

### 3. The operations, in the order the class needs them

- **S2:** `preorder`, `inorder`, `postorder` on
  `binary-tree`, valid on no other recipe. Each listing is the recursive
  method as the class writes it.
- **S3:** `height` and `search` on `binary-tree`.
- **Árboles II (#322):** a second recipe, `bst`. It was built for #321 and
  left with its slides when that class split (Miguel's review, 2026-10-12);
  it ships with Árboles II, which mounts it. `search` and `insert` first:
  `search` keeps ONE name across `binary-tree` and `bst` (and the chains),
  because two nearly identical tags are how a slide contrasts visiting
  everything with choosing a side, and `insert` becomes shared between
  `heap-max` and `bst`. Then `remove` in its three cases, the two-children
  case copying the successor's value into the node (which keeps its column)
  and removing the successor. `minimum` and `successor` were built too and
  went with their slides (Miguel's review, #322: "more tree exercises than
  matter"; the removal needs only the right subtree's minimum, which its own
  listing finds) — no operation ships without a slide that mounts it, so
  they come back with the exercise that wants them. `search` and `insert`
  may also show their iterative version beside the
  recursive one (`iterative`): the trace carries a second listing,
  `alongside`, and every frame the line of it that does what the recursive
  line does — the comparison in both, a call on a side against the variable
  stepping to it, a call on an empty side against the loop's condition
  failing, the leaf the recursion hangs on the way back against the parent
  the loop kept. The two share the code panel's width; Miguel's review of the
  search slide asked for them read together, and for every operation that
  can be written both ways. `remove`, the AVL's two and the traversals are
  not paired: the first needs the parent of every node through three cases,
  the AVL rebalances on the way back, and an iterative traversal is a stack
  — the iterator exercise. The translation is `pairListings`
  (`sequenceStepperTraceShared.ts`), shared with the array's binary search
  (ADR-0074). `insert` and `remove` may also run as a program (`program`),
  the operation called several times (Miguel's review: "one thing is walking
  a single value, and another the widget doing the same operation several
  times"). `insert`'s program is one frame per line, the tree drawn after
  each: what a run of insertions builds from an empty tree. `remove`'s is
  listed beside the method, which is walked for every removal with the
  program's line lit — the program on the left, the method on the right, as
  Miguel asked for the slide that runs every case in one tree; the trace
  names its two listings (`listingNames`) where the recursive and the
  iterative pair take the default ones.

None ships without a slide that mounts it (#296, ADR-0077 §5).

### 4. Authoring: the tree is written in level order, with `null` for a gap

A tree with no order cannot be built by inserting, so `values` on
`binary-tree` is the level order, `null` where a child is missing:
`[3, 9, 1, 4, 7, null, 6]`. A gap has no children written: after a `null`,
the next entries belong to the next node still waiting for its children, not
to the gap, so `[1, 2, null, 3, 4, null, null, 5]` hangs 5 under 4. That is
how trees are written down, and not the heap's rule, which numbers every
position, the empty ones included, and would hang 5 under 3 (#321 review,
pinned in `sequenceStepperTrace.test.ts`). A value with no parent is an
authoring error, and so are gaps left over at the end, once no node is
waiting; so is a `null` on any other recipe (it would otherwise be read as
`0`), and on every recipe a value that is not a finite number, a symbol or a
gap — an object would take the page down, and `NaN` would turn into a gap on
the way. The cap of eight counts nodes, not gaps.

A value on `binary-tree` may also be a **symbol** (Miguel's review of the
binary-tree act, #321): the class's guide example is the expression
(3 + 4) * (5 − 1), written `['*', '+', '−', 3, 4, 5, 1]`, operators as
symbols and operands as numbers, so `search` still compares numbers and finds
the 5. Each traversal then writes one notation of the expression into the
strip — prefix, infix (the strip under the nodes reads the expression,
without its parentheses), postfix — which is the reason the class uses it. A
symbol on any other recipe is an authoring error, as `null` is; the search
tree's values stay numbers, because its operations compare them.

The three traversal listings mark their two parts, `// visita` over the print
and `// recorrido` over the calls, the convention the general tree's code
slides set: the traversal stays, the visit is what a problem changes.

### 5. What the picture shows, decided for the class

- **The visit order as a number beside the node**, so the order reads
  without colour (`design-system.md`); it is also what the student writes in
  the pencil exercise.
- **The open calls as lit edges** from the root to the node under the
  algorithm's eye, in `focus`.
- **Every line a call runs is a frame of its own** on `binary-tree`, the
  base case included (Miguel's review of the traversal slides, #321): the
  call to each side lights its line and the edge down to the child; a call
  to an empty side lights the call AND `if (node == null)`, and the frame
  draws the empty subtree it landed on — a dashed box with `null` in it,
  under the parent on that side (`tree.probe`, geometry in
  `treeProbe`). The listings first lit only the print (or the answer, or
  the comparison): the two calls and the empty calls that end the
  recursion under every leaf never showed. The traversals, `height` and
  `search` share one helper for it, so the five read alike.
- **Numbers, not letters**, on both tree recipes: the frame model is numeric,
  and the reader uses one view for the binary tree and the search tree.
  Letters stay for the hand-drawn figures of the general tree.
- **Cap stays at eight.** Width would allow more, but the degenerate chain of
  the cost slide grows one level per value and stops fitting a slide.
- **Stacked in both modes**, listing over tree, like the chains — not side by
  side like the heap's two pictures, which are two views of one array.
- **What a search rules out (`bst`) is faded**, not outlined with a triangle as
  the old slides did: fading reads on any shape, the triangle tangles on a
  small or lopsided subtree.

These came out of the design step of #321. Both recipes are implemented in
full (`binary-tree` in #321, `bst` in #322) and ship with the classes that
mount them, so the ADR is Accepted with the professor's review of the recipes
running in `/catalog/c/SequenceStepper` still outstanding (#321 review, B14):
that review, not the code, is what closes it.

### 6. Amendment, #322: `avl`, and the rotation shown one assignment at a time

Árboles II teaches the rotation as a tool before the AVL tree that uses it,
so a third tree recipe, `avl`, starts with `rotate-right` and `rotate-left`
(`target`, the node that rotates), valid on no other recipe. Its trace is a
module of its own, `sequenceStepperAvlTrace.ts`, built on the pieces
`sequenceStepperTreeTrace.ts` exports (the node, the recorder, the search
tree built by inserting, the run's columns). Like the tree's, it imports only
types from the dispatcher, so the dispatcher's value import of `traceAvl`
closes no runtime cycle (§1).

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
  down.
- **`p` and `q` are written beside their nodes**, the listing's names, and
  the two nodes paint in `accent`, the unit's "being moved" token; the
  subtree that changes parent paints in `mark`. Colour is never the only
  signal: the badges and the narration name all three.
- **The double rotations are operations of their own**, `rotate-left-right`
  and `rotate-right-left` (Miguel's review: the doubles taught with the same
  script as the simple ones, definition, order, code and widget, before the
  AVL says when to use them). Their listing is a method of two calls —
  `p.left = rotateLeft(p.left); return rotateRight(p);` and its mirror —
  and the AVL's `balance` calls `rotateLeftRight` and `rotateRightLeft`
  instead of writing the two calls inline with a comment. The two simple
  rotations are listed side by side under it (`callees` on the trace, the
  lines each frame lights in them in `calleeLines`), and each call is
  walked inside its own listing an assignment at a time, the call lit
  above the whole time, levels held as the simple rotation's widget holds
  them. A first version gave each call one frame; Miguel's review: "the
  steps get lost". The names on the drawing are the running method's —
  inside `rotateLeft(p.left)`, its `p` is the outer `q`.
- **A rotation's example leans** (Miguel's review: "the tree comes out like
  a mirror"): every slide rotates a tree whose height the rotation lowers,
  and the last frame says so.
- **`insert` and `remove` are listed as the search tree lists them**, the
  public method over the private one, the first frame lighting the public
  call, with `return balance(node)` as the private one's last line — the
  script every operation of the class follows (Miguel's review of the AVL
  section). `insert` also runs as a program from an empty tree, the way
  `bst`'s removals do: the program beside the insert method, walked for
  every insertion. A first version drew each insertion as one or two
  frames with no method; Miguel's review put the single insertion and its
  code first, then the run of insertions with the code beside it, step by
  step.

Then `insert` and `remove`, the search tree's with `return balance(node)`
as their last line:

- **Their `values` build a real AVL**, rotating as it goes with no frames,
  because a slide that inserts into an AVL starts from one.
- **The balance factor is a badge on every node**, `+1`, `0`, `−2`, read off
  the heights the nodes STORE, as `balance` reads them. A factor above the
  node being balanced may therefore still be the old one, and changes when
  the walk back reaches it: that is when the code learns it. Computing the
  true factor everywhere would show a `−2` the code has not found yet.
- **Every node of the way back gets its `balance` frame**, with its height
  and factor narrated; the rotation inside is one frame (a double, two) —
  the rotation act already walked its assignments. The caller's assignment
  is made at once, so the drawing never shows a tree the code no longer
  holds.
- **`insert` and `remove` list `balance` beside them.**
  `insert` first showed the `balance` it calls under it, thirty-two lines,
  and its slide measured 0.545 against the 0.70 floor. Side by side the
  height is the taller listing's, not the sum: the trace carries a `row` of
  listings, each lit on its own (`rowLines`), and every frame of the walk
  back lights in `balance` what it does — its height and factor, the
  branch of the loaded side, the child's factor, the rotation it returns
  (Miguel's review: "put balance sharing the space with the insertion").
  Its two double returns go on a line of their own so a program, a method
  and `balance` fit three abreast — a fifth and two fifths each, two
  listings in halves (Miguel's widths). `remove` lists the search tree's
  lines without their comments, which do not fit two fifths of a slide.
  The class also puts `balance` on a slide of its own, as a fence, with the
  same lines. `remove` runs as a program too: the class's run of removals
  was searched on the trace's own model so five removals in eight nodes go
  through no rotation, a simple one, the simple one a child at 0 asks for,
  and a double.
- **The cascade in the widget: twelve nodes on an AVL.** A removal that
  rotates at two levels needs a tree of height 4 at least — the first
  rotation needs a node of height 2, the second an ancestor two levels
  above it — and the smallest AVL tree of height 4 has twelve nodes
  (N(h) = N(h − 1) + N(h − 2) + 1). The cap was eight for every recipe,
  and the class first drew the cascade with `<BinaryPicture>` only. Asked
  to run it in the widget (Miguel's review: "show the case of the cascade
  slide, then other removals"), the cap is twelve for `avl` × `insert` and
  `remove`, which build a real AVL — at most four levels with twelve
  nodes — and stays eight everywhere else: a search tree of twelve, the
  rotations' plain tree included, can be a chain eleven deep. The class
  keeps the drawn cascade for its four steps and runs it in the widget's
  program of removals, built by inserting the tree's level order.

This amendment is **Proposed**. The two recipes above ship with the classes
that mount them; `avl` ships with Árboles II, and the professor's review of it
running in `/catalog/c/SequenceStepper` (#322's checkpoint after its S2) is
what accepts it — the review, not the code.

## Alternatives considered

- **A `<TreeStepper>` widget of its own.** Refused for the reason ADR-0077
  refused `<HeapViz>`: a second surface for the same kind of animation, every
  guard re-earned. The professor refused it explicitly.
- **Reusing `heap-max`.** It draws an array read as a complete tree; the class
  needs linked nodes, any shape.
- **A centred layout (parents centred over children, Reingold–Tilford).**
  Prettier for balanced trees, but the strip under it would no longer line up
  with the nodes, and the inorder theorem is the reason for the strip.
- **A triangle over the discarded subtree** (the old slides). See §5.
- **Building the binary tree by insertion.** That is a search tree; a tree
  with no order has to be written out.

## Consequences

- The validity matrix grows two rows: `binary-tree` × {`preorder`,
  `inorder`, `postorder`, `height`, `search`} and `bst` × {`search`,
  `insert`, `inorder`, `remove`}; the tree-only operations are valid on
  no Sequence recipe
  (`add-a-course-document.md` §5h carries it). `bst`'s `inorder` (#322)
  is the binary tree's body behind a public `inorder()`, in a listing of
  its own, so the binary tree's — Árboles I's — is untouched; and every
  `bst` listing is the method the tree offers, `public`, and for the
  recursive ones the `private` method it calls with the root, which the
  first frame lights (Miguel's review: "these are private"). #322 adds a third row,
  `avl` × {`rotate-right`, `rotate-left`, `rotate-left-right`,
  `rotate-right-left`, `insert`, `remove`}; the four rotations are valid on
  nothing else.
- `SequenceCellState` gains `visited` and `discarded`; `SequenceStep` gains
  `tree`; `SequenceTrace` gains `tree` (columns, slots, depth, and whether
  it has a strip);
  `SequenceInput` gains `levelOrder`. The sequence and heap recipes never set
  them.
- The `size` readout is hidden on the tree recipes: their listings have no
  size field to show.
- **The picture exists only in a real browser.** The frames and the geometry
  are pinned exactly (`sequenceStepperTrace.test.ts`,
  `sequenceStepperTreeLayout.test.ts`), and the component test pins which
  nodes and slots are drawn and in which column; the paint is checked in
  `npm run preview`, in both themes.
