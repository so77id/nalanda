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
geometry lives in `sequenceStepperTreeLayout.ts`, as the heap's does.

### 2. Every node sits in the column of its inorder position

A node's x is its inorder position and its y its depth. A parent therefore
always sits between its two subtrees and no edge crosses another. Under the
tree, a strip has one slot per column, and a traversal writes its output into
it left to right. The inorder lands under its own nodes; the preorder and
postorder visibly do not. For a search tree (the `bst` recipe, S3) the same
strip reads sorted, which is the theorem the class states, made visible
rather than asserted.

The columns are fixed for the WHOLE run — every node the run ever holds is
placed once — so an insertion (S3) lands in a column already reserved and
nothing on screen moves: the rule `maxCells` keeps for the chains.

### 3. The operations, in the order the class needs them

- **S2:** `preorder`, `inorder`, `postorder` on
  `binary-tree`, valid on no other recipe. Each listing is the recursive
  method as the class writes it.
- **S3:** `height` and `search` on `binary-tree`; a second recipe, `bst`, with
  `search` and `insert`. `search` keeps ONE name across `binary-tree` and
  `bst` (and the chains), because two nearly identical tags are how a slide
  contrasts visiting everything with choosing a side. `insert` becomes shared
  between `heap-max` and `bst`.
- **S6:** the rest of `bst` — `minimum`, `successor` and `remove` in its
  three cases, the two-children case copying the successor's value into the
  node (which keeps its column) and removing the successor. Maximum and
  predecessor are their mirror images and stay in prose: no slide mounts them.

None ships without a slide that mounts it (#296, ADR-0077 §5).

### 4. Authoring: the tree is written in level order, with `null` for a gap

A tree with no order cannot be built by inserting, so `values` on
`binary-tree` is the level order, `null` where a child is missing:
`[3, 9, 1, 4, 7, null, 6]`. A value with no parent is an authoring error, and
so is a `null` on any other recipe (it would otherwise be read as `0`). The
cap of eight counts nodes, not gaps.

### 5. What the picture shows, decided for the class

- **The visit order as a number beside the node**, so the order reads
  without colour (`design-system.md`); it is also what the student writes in
  the pencil exercise.
- **The open calls as lit edges** from the root to the node under the
  algorithm's eye, in `focus`.
- **Numbers, not letters**, on both tree recipes: the frame model is numeric,
  and the reader uses one view for the binary tree and the search tree.
  Letters stay for the hand-drawn figures of the general tree.
- **Cap stays at eight.** Width would allow more, but the degenerate chain of
  the cost slide grows one level per value and stops fitting a slide.
- **Stacked in both modes**, listing over tree, like the chains — not side by
  side like the heap's two pictures, which are two views of one array.
- **What a search rules out (S3) is faded**, not outlined with a triangle as
  the old slides did: fading reads on any shape, the triangle tangles on a
  small or lopsided subtree.

These five came out of the design step of #321 and stay **Proposed** while the
professor has not reviewed the recipe running in `/catalog/c/SequenceStepper`.
The recipe is implemented in full (S2, S3, S6); its acceptance is that
review, not the code.

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
  `insert`, `minimum`, `successor`, `remove`}; the seven tree-only
  operations are valid on nothing else
  (`add-a-course-document.md` §5h carries it).
- `SequenceCellState` gains `visited` and `discarded`; `SequenceStep` gains
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
