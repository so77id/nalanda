# ADR-0083: `<SequenceStepper>` gains a linked binary tree — every node in the column of its inorder position

**Status:** Proposed
**Date:** 2026-10-11
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #321 (Estructuras de Datos Avanzadas · Árboles I), slice S2.
**Extends** ADR-0074, the same way ADR-0077 did: a new recipe,
`binary-tree`, with operations of its own and a picture of its own. ADR-0074
and ADR-0077 still hold entirely.

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
edge the two layouts share is another, `sequenceStepperEdge.ts`: neither pair
imports the other, so no cycle closes (#321 review).

### 2. Every node sits in the column of its inorder position

A node's x is its inorder position and its y its depth. A parent therefore
always sits between its two subtrees and no edge crosses another. Under the
tree, a strip has one slot per column, and a traversal writes its output into
it left to right. The inorder lands under its own nodes; the preorder and
postorder visibly do not.

The columns are fixed for the WHOLE run — every node the run ever holds is
placed once — so nothing on screen moves: the rule `maxCells` keeps for the
chains.

### 3. The operations, in the order the class needs them

- **S2:** `preorder`, `inorder`, `postorder` on
  `binary-tree`, valid on no other recipe. Each listing is the recursive
  method as the class writes it.
- **S3:** `height` and `search` on `binary-tree`. `search` keeps ONE name
  across `binary-tree` and the chains.

None ships without a slide that mounts it (#296, ADR-0077 §5). That is why
the search tree is not here: a second recipe, `bst` (`search`, `insert`,
`minimum`, `successor`, `remove`), was built for #321 and left with its
slides when the class split in two (Miguel's review, 2026-10-12). It ships
with Árboles II (#322), which mounts it.

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
- **Numbers, not letters**: the frame model is numeric, and letters stay for
  the hand-drawn figures of the general tree. An expression tree keeps its
  operators as symbols (§4).
- **Cap stays at eight.** Width would allow more, but the degenerate chain of
  the cost slide grows one level per value and stops fitting a slide.
- **Stacked in both modes**, listing over tree, like the chains — not side by
  side like the heap's two pictures, which are two views of one array.
These came out of the design step of #321 and stay **Proposed** while the
professor has not reviewed the recipe running in `/catalog/c/SequenceStepper`.
The recipe is implemented in full (S2, S3); its acceptance is that review,
not the code.

## Alternatives considered

- **A `<TreeStepper>` widget of its own.** Refused for the reason ADR-0077
  refused `<HeapViz>`: a second surface for the same kind of animation, every
  guard re-earned. The professor refused it explicitly.
- **Reusing `heap-max`.** It draws an array read as a complete tree; the class
  needs linked nodes, any shape.
- **A centred layout (parents centred over children, Reingold–Tilford).**
  Prettier for balanced trees, but the strip under it would no longer line up
  with the nodes, and the inorder theorem is the reason for the strip.
- **Building the binary tree by insertion.** That is a search tree; a tree
  with no order has to be written out.

## Consequences

- The validity matrix grows one row: `binary-tree` × {`preorder`,
  `inorder`, `postorder`, `height`, `search`}; the four tree-only
  operations are valid on nothing else
  (`add-a-course-document.md` §5h carries it).
- `SequenceCellState` gains `visited`; `SequenceStep` gains
  `tree`; `SequenceTrace` gains `tree` (columns, slots, depth);
  `SequenceInput` gains `levelOrder`. The sequence and heap recipes never set
  them.
- The `size` readout is hidden on the tree recipes: their listings have no
  size field to show.
- **The picture exists only in a real browser.** The frames and the geometry
  are pinned exactly (`sequenceStepperTrace.test.ts`,
  `sequenceStepperTreeLayout.test.ts`), and the component test pins which
  nodes and slots are drawn and in which column; the paint is checked in
  `npm run preview`, in both themes.
