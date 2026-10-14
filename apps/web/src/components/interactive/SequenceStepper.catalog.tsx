import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazySequenceStepper as SequenceStepper } from './lazySequenceStepper';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const sequenceStepperCatalogEntry: CatalogEntry = {
  name: 'SequenceStepper',
  family: 'interactive',
  description:
    'One step-through widget for the whole Sequence family. `eda` picks the structure it draws — a dynamic array, or a singly / doubly / circular linked list — and `operation` picks the animation it replays over it. Code panel on top, the structure as a hand-written SVG below, narration and controls at the foot; the surface is identical across all combinations, so the reader learns one visual vocabulary and reads every structure of the unit through it. ADR-0074. Since #304 it also draws a binary max-heap (`heap-max`, ADR-0077): the same array as the complete binary tree it encodes and as `data[0..]`, side by side on a slide and stacked in the book. Since #321 it draws a linked binary tree (`binary-tree`): every node in the column of its inorder position, with a strip underneath that a traversal fills one visit at a time — so the inorder lands under its own nodes and the other two orders visibly do not. A second tree recipe, `bst`, keeps the search-tree invariant: its `search` fades the side the invariant rules out, and its `insert` lands each value in a column reserved from the first frame, with the inorder kept sorted in the strip. Since #322 a third tree recipe, `avl`, rotates: one frame per reference the method changes, every node held at its level until the caller takes `q` (a reference pointing up gets an arrowhead), and the inorder in the strip unchanged from the first frame to the last; its `insert` and `remove` write the balance factor of every node beside it and rebalance on the way back.',
  whenToUse:
    'When a class of the Estructuras de Datos or the Estructuras de Datos Avanzadas unit shows an operation running over a sequence structure, `insert` / `extract-max` running over a binary max-heap (`heap-max`), or a traversal, the height or a search over a linked binary tree (`binary-tree`) — and especially when it shows the SAME operation over two structures to contrast their cost, which is two nearly identical tags. Not for sorting algorithms (`<SortStepper>`) and not for hand-authored memory pictures (`<StepShow>` + `<MemoryVisual>`).',
  props: [
    {
      name: 'eda',
      type: '"dynamic-array" | "linked-list-singly" | "linked-list-doubly" | "linked-list-circular" | "heap-max" | "binary-tree" | "bst" | "avl"',
      description:
        'Required. The recipe: which structure is drawn, and which Java listing is shown beside it.',
    },
    {
      name: 'operation',
      type: '"get-at" | "insert-first" | "insert-last" | "insert-at" | "insert-ordered" | "remove-first" | "remove-last" | "remove-at" | "search" | "insert" | "extract-max" | "preorder" | "inorder" | "postorder" | "height" | "remove"',
      description:
        'Required. Which operation to animate. `dynamic-array` and `linked-list-singly` accept all nine (bar `insert-ordered` on the dynamic array — the ordered array is not a structure this unit presents). The two VARIANT recipes accept only the operations they have a Java listing FOR, because the widget shows code a student may copy: `linked-list-circular` accepts `insert-first` alone — its listing closes the ring again, and walks to do it — and `linked-list-doubly` accepts `get-at`, `search`, `insert-first`, `remove-first`, and `remove-last` only with `tail`. `heap-max` accepts exactly its own two — `insert` (swim, growing the block like the dynamic array; `value` may be an array) and `extract-max` (sink, then `shrinkIfSparse`; `times` repeats it) — and those two are valid on no other recipe. `binary-tree` accepts the three traversals (`preorder`, `inorder`, `postorder`), `height` — none of the four valid on any other recipe — and `search`, which visits until the value turns up. `bst` accepts `search`, which chooses a side at every node; `insert` (`value` may be an array), which hangs each value as a leaf; `inorder`, the binary-tree walk behind a public method; and `remove` (`target`), in its three cases, the two-children one copying the value of the successor into the node and removing the successor instead; `search` thus keeps one name over the chains and both trees, and `insert` over the heap and the search tree. `avl` accepts `rotate-right` and `rotate-left` (`target`, the node that rotates: it needs the child that goes up), valid on no other recipe; its `values` build a PLAIN search tree, inserted in that order with no rebalancing, so a slide can rotate a tree that leans. It also accepts `insert` and `remove`, those of the search tree with `return balance(node)` as their last line: for these two `values` build a real AVL (rotating as it goes, with no frames), every node carries its balance factor in a badge, read off the heights the nodes store, and each node of the way back gets its `balance` frame — a rotation inside them is one frame, a double one two. Anything else renders an `<AuthoringError>` naming the operations that recipe does have.',
    },
    {
      name: 'values',
      type: '(number | string | null)[]',
      description:
        "Required. The starting contents in reading order. Up to 8; beyond that the nodes stop being legible when projected. May be empty for the insert operations that need no existing element: `insert-first`, `insert-last`, and `insert` on `heap-max`, which then starts at `new int[2]`. On `heap-max` it must already be a max-heap. On `binary-tree` it is the tree in LEVEL ORDER, `null` where a child is missing — `[3, 9, 1, 4, 7, null, 6]` is 3 over 9 and 1, 9 over 4 and 7, 1 over a lone right child 6 — and a `null` has no children written: the entries after it belong to the next node still waiting, so `[1, 2, null, 3, 4, null, null, 5]` hangs 5 under 4, not under 3 as the heap's numbering would. A value with no parent is refused, and so are gaps left over at the end. The cap counts nodes, not gaps. A value on `binary-tree` may also be a symbol, so an expression tree keeps its operators: `['*', '+', '−', 3, 4, 5, 1]` is (3 + 4) * (5 − 1). A `null` or a symbol on any other recipe is an authoring error.",
    },
    {
      name: 'value',
      type: 'number | number[]',
      description:
        'The value inserted. Required by `insert-first`, `insert-last` and `insert-at`, and by `insert` on `heap-max`. An ARRAY inserts each value in turn over the same chain, so a slide can show the list growing — `value={[9, 4, 6]}` runs three insertions end to end. `insert-first` and `insert-last` also accept `values={[]}`: a chain built from nothing shows the empty-chain branch taken once and, at the back, the walk getting one hop longer every time. `insert-at` needs one `index` per value.',
    },
    {
      name: 'index',
      type: 'number | number[]',
      description:
        'The position acted on. Required by `get-at`, `insert-at` (range `[0, size]`) and `remove-at` (range `[0, size - 1]`). An index outside the structure is an authoring error, checked against the chain as it is BY THEN — three insertions in a row move every position after the first. An ARRAY runs the operation once per index, which is how a slide shows a cost that depends on WHERE.',
    },
    {
      name: 'target',
      type: 'number | number[]',
      description:
        'The value looked for. Required by `search` and by `insert-ordered`, which also refuses a starting list that is not already sorted. An ARRAY searches each in turn — the hit at the front, the hit at the back and the value that is not there, in one widget. On the trees it is the node an operation acts on: `successor` and `remove` on `bst`, and the node that rotates on `avl`.',
    },
    {
      name: 'times',
      type: 'number',
      description:
        'How many times to run a removal that takes no argument (`remove-first`, `remove-last`, `extract-max`). Default one; at most twelve, on every recipe that reads it. The traversals and the height of `binary-tree` take no argument either, but run once over the whole tree and ignore it. Running more times than the structure has elements is an authoring error: the listing throws there, and a trace that ran anyway would be animating an exception.',
    },
    {
      name: 'capacity',
      type: 'number',
      description:
        '`dynamic-array` and `heap-max` only. On `dynamic-array` it is the block reserved, drawn as free slots past the live elements (one too small for `values` is refused at boot), and it is where the resize falls: the default starts the block FULL so that a single insertion shows the growth, and a slide running several insertions passes a larger one to choose WHICH of them pays for it. The drawing shows the block the current frame has, so filling and doubling happen on screen. On `heap-max` it is `data.length`, slot 0 included (so at least `values.length + 1`), and it defaults to full exactly as on `dynamic-array`.',
    },
    {
      name: 'method',
      type: 'string',
      description:
        "The name the LISTING shows the method under, when the document presents the structure through a TDA that calls it something else — a pila slide showing `pop` where the chain's own name is `deleteFirst`. The body is unchanged; the signature and every call in the driving program are renamed together, so the two never disagree. Pair it with `receiver`. Not on `binary-tree`: its listings are the recursive methods themselves, with no calling program to rename, and it ignores `method`, `receiver` and `receiverType`.",
    },
    {
      name: 'receiver',
      type: 'string',
      description:
        'The variable the driving program operates on, shown only when a slide runs the operation several times. Default `list` for the chains, `arreglo` for the dynamic array and `heap` for the heap. Pair it with `receiverType`.',
    },
    {
      name: 'receiverType',
      type: 'string',
      description:
        'The class the driving program CONSTRUCTS, renamed together with `method` and `receiver`. Without it a slide that renamed `insertFirst` to `push` still printed `LinkedList pila = new LinkedList();` under a heading that had just declared `class Stack` — the listing renamed the call and left the constructor telling the truth about the wrong structure. Every recipe but `binary-tree` alike; the defaults are `LinkedList`, `DynamicArray` and `MaxHeap`.',
    },
    {
      name: 'pointer',
      type: 'string',
      description:
        "`dynamic-array` only — a named arrow kept on every frame, aimed at the end the operation works on: the last live slot for the `*-last` operations, the first for the rest, and at nothing when the block is empty. `top` for a stack, `front` or `rear` for a queue. The `i` / `j` cursors belong to the OPERATION and vanish between runs; this one is the structure's own field, and naming it stands them down — `i` would land on the same cell and say the same thing with a second arrow.",
    },
    {
      name: 'tail',
      type: 'boolean',
      description:
        'List recipes only. Draws a `tail` pointer and lets the operations use it: `insert-last` drops to constant cost, and `remove-last` deliberately does NOT — on a singly linked list the missing piece is the PREVIOUS node, which no tail supplies. Default `false`.',
    },
    {
      name: 'iterative',
      type: 'boolean',
      description:
        'Shows the recursive version of the operation on the left and the iterative one on the right, the two listings sharing the width, each lit at every frame where the other is: the comparison in both, a call on a side against the variable stepping to it, a call on an empty side against the loop condition that fails. Valid on `dynamic-array` × `binary-search` (one target), and on `bst` × `search` and `insert` — the operations whose two versions take the same decisions in the same order. Anywhere else it is an authoring error. Default `false`.',
    },
    {
      name: 'program',
      type: 'boolean',
      description:
        '`bst` × `insert` from `values={[]}`, or `bst` × `remove` with `target` an array. On `insert` the listing becomes the program that builds the tree — `BST<Integer> tree = new BST<>();`, then one `tree.insert(x);` per value — one frame per line, the tree drawn after each with the new leaf marked and the way it came down lit: what a run of insertions builds, not the descent inside the method. On `remove` the program — the tree built from `values` by a loop of insertions, then one `tree.remove(x);` per target — is listed beside the method it calls, each under its own heading: every removal is walked through the method as a single one is, its program line lit the whole time, so one tree goes through every case in turn (a leaf, one child, two children, the root, a value that is not there). The program takes the width its lines need and the method the rest; in the book the program goes on top. Anywhere else it is an authoring error. Default `false`.',
    },
    {
      name: 'autoplay',
      type: 'boolean',
      description: 'Autoplay on mount. Off by default (rule Peli 1/2 — the reader decides when).',
    },
    {
      name: 'speed',
      type: '"slow" | "normal" | "fast"',
      description:
        'Delay between automatic steps. Does not change the number of steps. Default `normal`.',
    },
    {
      name: 'showCode',
      type: 'boolean',
      description:
        'Show the Java listing panel. Set it false when the slide already carries the code. Default `true`.',
    },
    {
      name: 'title',
      type: 'string',
      description:
        'Overrides the widget heading, which otherwise names the operation and the structure.',
    },
  ],
  examples: [
    {
      title: 'insertFirst on a singly linked list — the constant-time insertion',
      code: '<SequenceStepper eda="linked-list-singly" operation="insert-first" values={[7, 3, 1, 5]} value={9} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="insert-first"
          values={[7, 3, 1, 5]}
          value={9}
        />
      ),
    },
    {
      title: 'Three insertions in a row — the chain growing',
      code: '<SequenceStepper eda="linked-list-singly" operation="insert-first" values={[7, 3]} value={[9, 4, 6]} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="insert-first"
          values={[7, 3]}
          value={[9, 4, 6]}
        />
      ),
    },
    {
      title: 'A chain built from nothing, at the back — the walk gets longer',
      code: '<SequenceStepper eda="linked-list-singly" operation="insert-last" values={[]} value={[5, 1, 3, 7]} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="insert-last"
          values={[]}
          value={[5, 1, 3, 7]}
        />
      ),
    },
    {
      title: 'One operation, three positions — the cost is the position',
      code: '<SequenceStepper eda="linked-list-singly" operation="get-at" values={[7, 3, 1, 5, 9, 2, 8]} index={[0, 3, 6]} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="get-at"
          values={[7, 3, 1, 5, 9, 2, 8]}
          index={[0, 3, 6]}
        />
      ),
    },
    {
      title: 'deleteFirst three times — the chain shrinks, the cost does not',
      code: '<SequenceStepper eda="linked-list-singly" operation="remove-first" values={[7, 3, 1, 5]} times={3} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="remove-first"
          values={[7, 3, 1, 5]}
          times={3}
        />
      ),
    },
    {
      title: 'The same insertion on an array — every element shifts',
      code: '<SequenceStepper eda="dynamic-array" capacity={6} operation="insert-first" values={[7, 3, 1, 5]} value={9} />',
      render: () => (
        <SequenceStepper
          eda="dynamic-array"
          capacity={6}
          operation="insert-first"
          values={[7, 3, 1, 5]}
          value={9}
        />
      ),
    },
    {
      title: 'A dynamic array filling up and doubling, with `top` kept on screen',
      code: '<SequenceStepper eda="dynamic-array" capacity={4} operation="insert-last" values={[42, 7]} value={[15, 4, 9, 23]} pointer="top" />',
      render: () => (
        <SequenceStepper
          eda="dynamic-array"
          capacity={4}
          operation="insert-last"
          values={[42, 7]}
          value={[15, 4, 9, 23]}
          pointer="top"
        />
      ),
    },
    {
      title: 'insertLast with a tail pointer — no walk at all',
      code: '<SequenceStepper eda="linked-list-singly" operation="insert-last" values={[7, 3, 1]} value={9} tail />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="insert-last"
          values={[7, 3, 1]}
          value={9}
          tail
        />
      ),
    },
    {
      title: 'A doubly linked list deleting its last node in constant time',
      code: '<SequenceStepper eda="linked-list-doubly" operation="remove-last" values={[7, 3, 1, 5]} tail />',
      render: () => (
        <SequenceStepper
          eda="linked-list-doubly"
          operation="remove-last"
          values={[7, 3, 1, 5]}
          tail
        />
      ),
    },
    {
      title: 'A circular list, where the last node points back at the first',
      code: '<SequenceStepper eda="linked-list-circular" operation="insert-first" values={[7, 3, 1]} value={9} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-circular"
          operation="insert-first"
          values={[7, 3, 1]}
          value={9}
        />
      ),
    },
    {
      title: 'getAt on a chain — one frame per hop, none skipped',
      code: '<SequenceStepper eda="linked-list-singly" operation="get-at" values={[7, 3, 1, 5]} index={2} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="get-at"
          values={[7, 3, 1, 5]}
          index={2}
        />
      ),
    },
    {
      title: 'The same getAt on an array — one calculation, whatever the position',
      code: '<SequenceStepper eda="dynamic-array" operation="get-at" values={[7, 3, 1, 5]} index={2} />',
      render: () => (
        <SequenceStepper eda="dynamic-array" operation="get-at" values={[7, 3, 1, 5]} index={2} />
      ),
    },
    {
      title: 'The same chain, presented as the pila a Stack slide declares',
      code: '<SequenceStepper eda="linked-list-singly" operation="remove-first" values={[9, 4, 15]} method="pop" receiver="pila" receiverType="Stack" />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="remove-first"
          values={[9, 4, 15]}
          method="pop"
          receiver="pila"
          receiverType="Stack"
        />
      ),
    },
    {
      title: 'A max-heap taking three insertions, each swimming up to its place',
      code: '<SequenceStepper eda="heap-max" operation="insert" values={[10, 8, 9, 3, 7]} value={[12, 1, 11]} capacity={9} />',
      render: () => (
        <SequenceStepper
          eda="heap-max"
          operation="insert"
          values={[10, 8, 9, 3, 7]}
          value={[12, 1, 11]}
          capacity={9}
        />
      ),
    },
    {
      title: 'extractMax: the root swapped with the last leaf, n--, and the new root sinking',
      code: '<SequenceStepper eda="heap-max" operation="extract-max" values={[12, 8, 10, 3, 7, 9]} />',
      render: () => (
        <SequenceStepper eda="heap-max" operation="extract-max" values={[12, 8, 10, 3, 7, 9]} />
      ),
    },
    {
      title: 'An inorder traversal: every value lands in the strip right under its own node',
      code: '<SequenceStepper eda="binary-tree" operation="inorder" values={[3, 9, 1, 4, 7, null, 6]} />',
      render: () => (
        <SequenceStepper eda="binary-tree" operation="inorder" values={[3, 9, 1, 4, 7, null, 6]} />
      ),
    },
    {
      title: 'An expression tree, operators as symbols: its inorder writes the expression under it',
      code: "<SequenceStepper eda=\"binary-tree\" operation=\"inorder\" values={['*', '+', '−', 3, 4, 5, 1]} />",
      render: () => (
        <SequenceStepper
          eda="binary-tree"
          operation="inorder"
          values={['*', '+', '−', 3, 4, 5, 1]}
        />
      ),
    },
    {
      title: 'The same tree in preorder: the visit moves before the two calls',
      code: '<SequenceStepper eda="binary-tree" operation="preorder" values={[3, 9, 1, 4, 7, null, 6]} />',
      render: () => (
        <SequenceStepper eda="binary-tree" operation="preorder" values={[3, 9, 1, 4, 7, null, 6]} />
      ),
    },
    {
      title: 'And in postorder: a node is visited only after both of its sides',
      code: '<SequenceStepper eda="binary-tree" operation="postorder" values={[3, 9, 1, 4, 7, null, 6]} />',
      render: () => (
        <SequenceStepper
          eda="binary-tree"
          operation="postorder"
          values={[3, 9, 1, 4, 7, null, 6]}
        />
      ),
    },
    {
      title: 'The height, answered from the leaves up: every call after both of its sides',
      code: '<SequenceStepper eda="binary-tree" operation="height" values={[3, 9, 1, 4, 7, null, 6]} />',
      render: () => (
        <SequenceStepper eda="binary-tree" operation="height" values={[3, 9, 1, 4, 7, null, 6]} />
      ),
    },
    {
      title: 'A binary search over a sorted array: each comparison rules out half of what is left',
      code: '<SequenceStepper eda="dynamic-array" operation="binary-search" values={[2, 4, 6, 8, 10, 12, 14]} target={7} />',
      render: () => (
        <SequenceStepper
          eda="dynamic-array"
          operation="binary-search"
          values={[2, 4, 6, 8, 10, 12, 14]}
          target={7}
        />
      ),
    },
    {
      title: 'Searching a tree with no order: it may have to compare every node',
      code: '<SequenceStepper eda="binary-tree" operation="search" values={[4, 2, 7, 1, 3, 6, 9]} target={6} />',
      render: () => (
        <SequenceStepper
          eda="binary-tree"
          operation="search"
          values={[4, 2, 7, 1, 3, 6, 9]}
          target={6}
        />
      ),
    },
    {
      title: 'The same values as a search tree: the invariant rules a whole side out at every node',
      code: '<SequenceStepper eda="bst" operation="search" values={[4, 2, 7, 1, 3, 6, 9]} target={6} />',
      render: () => (
        <SequenceStepper eda="bst" operation="search" values={[4, 2, 7, 1, 3, 6, 9]} target={6} />
      ),
    },
    {
      title: 'The same search written twice, recursive and iterative, lit together',
      code: '<SequenceStepper eda="bst" operation="search" values={[8, 4, 12, 2, 6, 10, 14]} target={10} iterative />',
      render: () => (
        <SequenceStepper
          eda="bst"
          operation="search"
          values={[8, 4, 12, 2, 6, 10, 14]}
          target={10}
          iterative
        />
      ),
    },
    {
      title: 'A tree built by a program: one frame per insertion, the tree after each',
      code: '<SequenceStepper eda="bst" operation="insert" values={[]} value={[8, 4, 12, 2, 6]} program />',
      render: () => (
        <SequenceStepper
          eda="bst"
          operation="insert"
          values={[]}
          value={[8, 4, 12, 2, 6]}
          program
        />
      ),
    },
    {
      title: 'Removals run by a program: the program beside the method, every removal walked',
      code: '<SequenceStepper eda="bst" operation="remove" values={[8, 3, 12, 1, 6, 10, 14, 11]} target={[1, 3, 8, 12, 14, 5]} program />',
      render: () => (
        <SequenceStepper
          eda="bst"
          operation="remove"
          values={[8, 3, 12, 1, 6, 10, 14, 11]}
          target={[1, 3, 8, 12, 14, 5]}
          program
        />
      ),
    },
    {
      title: 'Inserting into a search tree: each value lands in a column reserved for it',
      code: '<SequenceStepper eda="bst" operation="insert" values={[8, 5, 1, 4, 6, 7, 20]} value={12} />',
      render: () => (
        <SequenceStepper eda="bst" operation="insert" values={[8, 5, 1, 4, 6, 7, 20]} value={12} />
      ),
    },
    {
      title: "Removing a node with two children: it takes its successor's value",
      code: '<SequenceStepper eda="bst" operation="remove" values={[8, 5, 1, 4, 6, 7, 20, 12]} target={8} />',
      render: () => (
        <SequenceStepper
          eda="bst"
          operation="remove"
          values={[8, 5, 1, 4, 6, 7, 20, 12]}
          target={8}
        />
      ),
    },
    {
      title:
        'A right rotation on a tree leaning left: three references change, the height drops, and the inorder does not change',
      code: '<SequenceStepper eda="avl" operation="rotate-right" values={[6, 4, 7, 2, 5, 1]} target={6} />',
      render: () => (
        <SequenceStepper
          eda="avl"
          operation="rotate-right"
          values={[6, 4, 7, 2, 5, 1]}
          target={6}
        />
      ),
    },
    {
      title: 'A left rotation lowers a chain leaning right',
      code: '<SequenceStepper eda="avl" operation="rotate-left" values={[1, 2, 3]} target={1} />',
      render: () => (
        <SequenceStepper eda="avl" operation="rotate-left" values={[1, 2, 3]} target={1} />
      ),
    },
    {
      title: 'Inserting 30, 10 and 20 into an empty AVL tree: the double rotation to the right',
      code: '<SequenceStepper eda="avl" operation="insert" values={[]} value={[30, 10, 20]} />',
      render: () => (
        <SequenceStepper eda="avl" operation="insert" values={[]} value={[30, 10, 20]} />
      ),
    },
    {
      title: 'Removing from an AVL tree: a child with factor 0 takes a single rotation',
      code: '<SequenceStepper eda="avl" operation="remove" values={[4, 2, 5, 1, 3]} target={5} />',
      render: () => (
        <SequenceStepper eda="avl" operation="remove" values={[4, 2, 5, 1, 3]} target={5} />
      ),
    },
    {
      title: 'Searching a chain, which has no address arithmetic to shortcut with',
      code: '<SequenceStepper eda="linked-list-singly" operation="search" values={[7, 3, 1, 5]} target={1} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="search"
          values={[7, 3, 1, 5]}
          target={1}
        />
      ),
    },
  ],
};
