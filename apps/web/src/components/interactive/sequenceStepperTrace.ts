/**
 * Pure traces for `<SequenceStepper>` (ADR-0074). One function turns a recipe
 * (which structure), an operation (which animation) and an author-written
 * input into a frame list the widget replays — and into the Java listing the
 * frames highlight lines of.
 *
 * Exported so the suite can pin every valid combination without touching the
 * DOM: the paint is derived from these frames, so a frame list checked exactly
 * leaves the browser only "does it look right" (`apps/web/CLAUDE.md` §2).
 *
 * Frame conventions the widget renders:
 * - `cells` is the structure AFTER this step's effect, in reading order. Each
 *   carries a STABLE `id`, so a node that merely moved is the same node to the
 *   view and can be animated rather than re-created.
 * - `pointers` are the named arrows drawn under (array) or over (list) the
 *   structure. `index: null` means the pointer points at `null` — past the end
 *   of the chain, which is the terminating case every walk ends on.
 * - `cost` is the running count of elementary operations THIS run has spent.
 *   The widget no longer prints it (#294: one run shows one number, and one
 *   number is not a growth rate); the suite reads it to pin what each
 *   operation costs.
 * - `capacity` is the reserved block, for the dynamic array and the heap.
 *   Both grow mid-trace, and the heap's also shrinks.
 * - `closesRing` marks the circular recipe, whose last node points back at the
 *   first rather than at `null`.
 */

import {
  asRuns,
  lineOf,
  pairListings,
  requireRuns,
  type ListingPairs,
} from './sequenceStepperTraceShared';
import { traceAvl } from './sequenceStepperAvlTrace';
import { traceHash } from './sequenceStepperHashTrace';
import { traceProbe } from './sequenceStepperProbeTrace';
import { traceSearchTree, traceTree } from './sequenceStepperTreeTrace';

export const RECIPES = [
  'dynamic-array',
  'linked-list-singly',
  'linked-list-doubly',
  'linked-list-circular',
  // A binary max-heap stored 1-based in an array (#304, ADR-0077). Not a
  // Sequence at all — it has its own two operations and draws the array
  // beside the complete binary tree it encodes — but it is the same widget:
  // one listing, one structure, the same controls and the same frame model.
  'heap-max',
  // A linked binary tree (#321): nodes with `left` and `right`, drawn with
  // every node in the column of its inorder position. `binary-tree` has no
  // order, so its operations visit; `bst` keeps the search-tree invariant, so
  // its operations choose a side. Same widget, same frame model plus a tree.
  'binary-tree',
  'bst',
  // The AVL tree (#322): a search tree that keeps its shape. It rotates, and
  // a rotation changes links, not the inorder, so it shares the tree view
  // and the column of every node.
  'avl',
  // A hash table with one list per position (#326): `table[i]` is the first
  // node of the list of position `i`, and every key lives in the list of the
  // position its hash names. Its keys are text, and its operations are the
  // ones a set of keys needs: search, insert, remove.
  'hash-chaining',
  // The same set of keys with linear probing (#326): the keys live in the
  // array itself, a taken cell sends a key to the next one, and a parallel
  // `boolean[] deleted` marks a removed key so a search passes over it.
  'hash-probing',
] as const;
export type SequenceRecipe = (typeof RECIPES)[number];

export const OPERATIONS = [
  'get-at',
  'insert-first',
  'insert-last',
  'insert-at',
  'insert-ordered',
  'remove-first',
  'remove-last',
  'remove-at',
  'search',
  // The dynamic array's own (#322): the search a SORTED array allows, which
  // discards half of what is left at every comparison. Árboles II opens on it.
  'binary-search',
  // The heap's own operations — valid on `heap-max` and nowhere else.
  // `swim` and `sink` are not among them: they are the INSIDE of these
  // (their lines light up in the listing), not operations of the TDA.
  'insert',
  'extract-max',
  // The tree's own operations (#321): the three ways to visit every node, and
  // the height. `search` and `insert` above are shared with the trees: the
  // same tag over `binary-tree` and `bst` is how a slide contrasts visiting
  // everything with choosing a side.
  'preorder',
  'inorder',
  'postorder',
  'height',
  // The search tree's own (#321): the removal, down one path to the node
  // and down another to its successor. The hash table shares it (#326): take
  // a key out, wherever its list keeps it — one name per idea across the
  // recipes, as `search` and `insert` already are.
  'remove',
  // The AVL tree's own (#322): the rotation, the tool its insertions and
  // removals use to keep the shape, shown on its own first.
  'rotate-right',
  'rotate-left',
  // The double rotations, two simple ones in a row: the child first, toward
  // the side the node leans, then the node (#322).
  'rotate-left-right',
  'rotate-right-left',
  // The hash table's too: a new table of more positions, every key put back
  // in through `add`, because the position a key hashes to depends on them.
  'resize',
] as const;
export type SequenceOperation = (typeof OPERATIONS)[number];

export type SequenceStepKind =
  | 'start'
  | 'walk'
  | 'compare'
  | 'shift'
  | 'grow'
  | 'shrink'
  | 'build'
  | 'link'
  | 'unlink'
  | 'found'
  | 'done';

/**
 * `leaving` is an element ON ITS WAY OUT of the structure. `stale` is a
 * different thing that looks similar and is not: the SOURCE of a copy, whose
 * value is still written in the block and which nobody will read again. The
 * array shift needs both words — the element that leaves, and the copies it
 * leaves behind — and painting them the same said "move" where the narration
 * said "copy" (#294 review).
 */
export type SequenceCellState =
  | 'idle'
  | 'new'
  | 'active'
  | 'found'
  | 'leaving'
  | 'stale'
  /**
   * Heap: one of the two cells being exchanged by `swap` this frame. AVL:
   * one of the two nodes a rotation exchanges, the one going up and the one
   * going down.
   */
  | 'swap'
  /** Tree: a node the operation has already finished with. */
  | 'visited'
  /** Tree: a node the search-tree invariant has just ruled out. */
  | 'discarded';

/**
 * What a tree node holds: a number, or — on `binary-tree` only — a symbol, so
 * an expression tree can be drawn with its operators (`'*'`, `'+'`, `'−'`) as
 * operators and its operands as numbers.
 */
export type TreeValue = number | string;

/** One node of a tree frame: its value, its two links and its paint. */
export interface TreeFrameNode {
  id: number;
  value: TreeValue;
  left: number | null;
  right: number | null;
  /**
   * The node's level, the root's 0: the row the view draws it on. While a
   * rotation runs, every node keeps the level it had — the method changes
   * links, not places — so a reference can point UP (`q.right = p`) before
   * the caller takes `q`; the view draws that one with an arrowhead.
   */
  depth: number;
  state: SequenceCellState;
  /**
   * A short mark beside the node: its visit order, what its call returned,
   * or the name a rotation's listing gives it (`p`, `q`).
   */
  badge?: string;
}

/**
 * The tree as one frame leaves it. `path` is the chain of calls still open,
 * root first, so the view can light the edges the recursion is standing on.
 * `strip` has one slot per column of the drawing: a traversal writes its
 * output there left to right, and the `bst` recipe shows its inorder there,
 * every value under its own node.
 */
export interface TreeFrame {
  root: number | null;
  nodes: TreeFrameNode[];
  path: number[];
  strip: (TreeValue | null)[];
  /** The slot just written, painted as new. */
  stripFresh?: number;
  /**
   * A call that landed on an empty subtree: the side of `parent` it went to.
   * That call is the base case, and the view draws the empty subtree there
   * for the one frame it runs.
   */
  probe?: { parent: number; side: 'left' | 'right' };
}

/** One node of a list of the hash table: its key and its paint. */
export interface HashFrameNode {
  id: number;
  key: string;
  state: SequenceCellState;
}

/**
 * The hash table as one frame leaves it (#326): one list per position of
 * `table`, its first node first. `bucket` is the position the hash of `key`
 * named — `null` until the line that computes it runs.
 */
export interface HashFrame {
  chains: HashFrameNode[][];
  key: string;
  bucket: number | null;
  /** The listing's `size` field, which `resize` sets back to 0 and counts again. */
  size: number;
  /**
   * The references the listing holds into a list — `current`, `prev` — by
   * node id; `null` when it points at null, past the end of the list. `old`
   * marks one that walks the old table during `resize`.
   */
  pointers: { name: string; node: number | null; old?: boolean }[];
  /**
   * `resize` only: the table `old` names. `aliased` while `table` still
   * names it too — the frame between `old = table` and the new array.
   * `bucket` is the position of `old` the loop is reading.
   */
  old?: { chains: HashFrameNode[][]; bucket: number | null; aliased: boolean };
  /**
   * `add` only: the node built and not yet in its list. `next` is the id it
   * points at, `null` for null, and absent while the field is unassigned;
   * `held` once `table[i]` points at it, the frame before it takes its place.
   */
  fresh?: { id: number; key: string; next?: number | null; held: boolean };
  /**
   * `remove` only: the link that skips the leaving node — from the node at
   * `from` in the list of `bucket`, or from `table[bucket]` itself when
   * `from` is null. Drawn for the one frame between the assignment and
   * `size--`, while the leaving node is still on screen.
   */
  bypass?: { bucket: number; from: number | null };
}

/**
 * What a hash run needs to keep one canvas: its positions, its longest list
 * and — for `resize` — the positions of the old table drawn beside the new.
 */
export interface HashRun {
  buckets: number;
  longest: number;
  oldBuckets?: number;
}

/** One cell of the probing table: the key in `keys[i]` (null if none ever was) and `deleted[i]`. */
export interface ProbeCell {
  key: string | null;
  deleted: boolean;
  state: SequenceCellState;
}

/**
 * The probing table as one frame leaves it (#326): `keys` and `deleted` cell
 * by cell. `home` is the position the hash of `key` named, and `at` the
 * listing's cursor `i` — both null until the line that sets them runs.
 */
export interface ProbeFrame {
  cells: ProbeCell[];
  key: string;
  home: number | null;
  at: number | null;
  /** The listing's `size`: the keys not marked. */
  size: number;
  /** The listing's `used`: the cells that are not null, keys and marks (#326 review). */
  used: number;
}

export interface SequenceCell {
  /** Stable across frames — the view animates by identity, not by position. */
  id: number;
  value: number;
  state: SequenceCellState;
}

export interface SequencePointer {
  /**
   * `head`, `tail`, `current`, `prev` for lists; `i`, `j` for arrays; `k`,
   * `j` for the heap, which index `data` 1-based.
   */
  name: string;
  /** Index into `cells`, or `null` for a pointer aimed past the end. */
  index: number | null;
  /**
   * A FIELD of the structure (`head`, `tail`, `top`), drawn on every frame,
   * against a CURSOR of the operation running (`i`, `j`), which exists only
   * while it runs. The view draws them on separate rows and nudges a cursor
   * that lands on a field, so the two never share a label position.
   */
  fixed?: boolean;
}

export interface SequenceStep {
  kind: SequenceStepKind;
  cells: SequenceCell[];
  pointers: SequencePointer[];
  /** 1-based lines of `trace.code` this frame is executing. */
  highlightLines: number[];
  /** The same moment in `trace.alongside`, when the trace carries a second listing. */
  alongsideLines?: number[];
  /** The lines each of `trace.callees` lights at this moment, in the same order. */
  calleeLines?: number[][];
  /** The lines each listing of `trace.row` lights at this moment, in the same order. */
  rowLines?: number[][];
  /**
   * The value a search is looking for, written beside the structure on every
   * frame of its run (#322): the narration names it once, and a reader who
   * joins mid-walk should not have to scroll back to learn what is sought.
   */
  seek?: number;
  description: string;
  /** The dynamic array and the heap: the reserved block size (`data.length`). */
  capacity?: number;
  /**
   * The dynamic array only: the block slot by slot, `null` where a slot
   * holds nothing. This is what makes a shift VISIBLE — the copies travel
   * through the block — and a shift the reader cannot see is a
   * $$\Theta(N)$$ the reader has to take on faith. `cells` is the occupied
   * slots in order with the holes dropped (a stale copy is still a cell), so
   * a reader that ignores the block is unaffected. The heap encodes its
   * block differently: no `slots`, and `heapSize` marks where the live cells
   * end (ADR-0077).
   */
  slots?: (SequenceCell | null)[];
  /**
   * A node that EXISTS but is not in the chain yet — drawn as a real node
   * with its own `next` field, because that field is what the operation
   * assigns and the reader has to watch it happen. `next` is the index of
   * the cell it points at, `null` for a link that points at null, and
   * `undefined` while the field has not been assigned at all.
   */
  carry?: {
    value: number;
    label: string;
    next?: number | null;
    /**
     * The slot the floating node is parked ABOVE, so it hovers over the
     * place it is about to land rather than over the front of the structure.
     * Set by the back-growing list operations and by every array insertion.
     * Absent for the rest, which keep their node where it has always been.
     */
    slot?: number;
  };
  /** Circular recipe: the chain closes back on its first node. */
  closesRing?: boolean;
  /**
   * Heap recipe only: the listing's `n`. `cells` is `data[1..]` in array
   * order, and the cells past `n` are OUTSIDE the heap — the stale copy an
   * extraction leaves in `data[n + 1]`. The tree draws the first `n`; the
   * array draws them all.
   */
  heapSize?: number;
  /**
   * `head` points at the FLOATING node rather than at the chain. True for the
   * one frame between `head = fresh` running and the node taking its place in
   * the chain — the frame that shows the reassignment before the move, so the
   * two are not conflated into a single jump.
   */
  headToCarry?: boolean;
  /**
   * The index of the node whose `next` points at the FLOATING node rather
   * than where it used to. The mirror of `headToCarry` for a node instead of
   * a variable: the one frame between the assignment running and the node
   * taking its place in the chain. `insertLast` names the last node,
   * `insertAt` the previous one — the assignment is the same, and so is the
   * frame that shows it before the move.
   */
  linkToCarry?: number;
  /**
   * Elementary operations THIS run has spent. Reset on every call, because
   * every narration and every line of prose beside the widget is per-call: a
   * slide that says "ninguna, tres y seis saltos" is falsified by a counter
   * reading 0, 3 and 9 (#288 review, COR-6b).
   */
  cost: number;
  /** Tree recipes only: the tree this frame leaves. `cells` mirrors its nodes. */
  tree?: TreeFrame;
  /** The hash recipe only: the table this frame leaves. `cells` mirrors its keys. */
  hash?: HashFrame;
  /** The probing recipe only: `keys` and `deleted` as this frame leaves them. */
  probe?: ProbeFrame;
}

export interface SequenceTrace {
  steps: SequenceStep[];
  code: string;
  /**
   * A second listing of the same operation, drawn beside the first and lit
   * at every frame where the first is (`alongsideLines`): the search tree's
   * `contains` written as a loop beside the recursive one (#322).
   */
  alongside?: string;
  /**
   * What the two listings are called, left then right, when the trace
   * carries `alongside`. Without it they are the recursive and the iterative
   * version of one operation; a program of removals names its own: the
   * program, and the method it calls (#322).
   */
  listingNames?: [string, string];
  /**
   * The methods the listing calls, drawn side by side under it, each with
   * the lines a frame lights in it (`calleeLines`): the double rotation's
   * two simple ones, walked an assignment at a time while the call that
   * runs them stays lit above (#322).
   */
  callees?: { name: string; code: string }[];
  /**
   * Listings drawn side by side in one row, each named and lit on its own
   * (`rowLines`): the AVL's insert beside the balance it calls, and a
   * program of insertions beside both (#322). The first is `code`.
   */
  row?: { name: string; code: string }[];
  /**
   * The most cells any frame holds. The view lays out for THIS, not for the
   * current frame, so the drawing keeps one size from the first frame to the
   * last — a chain that resizes under the reader on every insertion is a
   * chain nobody can follow.
   */
  maxCells: number;
  /**
   * Which end the structure grows from. `right` means new cells arrive at the
   * FRONT, so the existing ones are drawn flush right and a new node lands in
   * the slot already reserved above it, moving nothing.
   */
  align: 'left' | 'right';
  /**
   * Whether ANY frame floats a node above the structure. The row is reserved
   * for the whole trace when so: reserving it per frame made the drawing
   * change height — and therefore width — every time a node appeared or
   * landed, which is the resizing that makes an animation unreadable.
   */
  hasCarry: boolean;
  /** Tree recipes only: what the whole run needs to keep one canvas. */
  tree?: TreeRun;
  /** The hash recipe only: what the whole run needs to keep one canvas. */
  hash?: HashRun;
  /** The probing recipe only: its positions. */
  probe?: { buckets: number };
}

/**
 * `columns` places every node the run holds in a column fixed for the whole
 * run — its inorder position — so nothing on screen moves sideways (the rule
 * `maxCells` keeps for the chains); a tree that grows during the run, as the
 * search tree of #322 does, reserves the columns of the nodes it will insert.
 * `depth` is the deepest level any frame reaches, so the canvas keeps one
 * height too. `strip` says whether the operation writes anything out: a
 * height or a search does not, and gets no strip at all rather than an empty
 * one.
 */
export interface TreeRun {
  columns: Record<number, number>;
  slots: number;
  depth: number;
  strip: boolean;
}

export interface SequenceInput {
  values: number[];
  /**
   * `binary-tree` only: the tree in level order, `null` where a child is
   * missing — `[3, 9, 1, 4, 7, null, 6]`. A tree with no order cannot be
   * built by inserting, so its shape has to be written out.
   */
  levelOrder?: (TreeValue | null)[];
  /**
   * The hash recipe only: the keys already in the table, added in this order,
   * each at the front of the list of its position. Keys are text — the class's
   * table holds `String`s — so they travel apart from the numeric `values`.
   */
  keys?: string[];
  /**
   * The hash recipe only: the key the operation works with. An ARRAY runs it
   * once per key over the same table. The component reads it from `target`
   * (search, remove) or `value` (insert), the props every recipe uses.
   */
  key?: string | string[];
  /**
   * `hash-probing` only: keys of `keys` that were removed — each stays in its
   * cell with `deleted[i]` set, so a slide can start from a table with marks.
   */
  deleted?: string[];
  /**
   * Required by every `insert-*` except `insert-ordered`, and by the heap's
   * `insert`. An ARRAY inserts
   * each value in turn over the same chain, so a slide can show the list
   * growing rather than one insertion in isolation.
   */
  value?: number | number[];
  /**
   * Required by `get-at`, `insert-at` and `remove-at`. An ARRAY runs the
   * operation once per index, over the same chain and in order — which is
   * how a slide shows a cost that depends on WHERE, rather than asserting it.
   */
  index?: number | number[];
  /** Required by `search` and `insert-ordered`. An ARRAY searches each. */
  target?: number | number[];
  /**
   * How many times to run an operation that takes no argument
   * (`remove-first`, `remove-last`, `extract-max`). Default one.
   */
  times?: number;
  /**
   * The dynamic array and the heap: how many slots the block reserves (the
   * heap's counts `data[0]`, which it never uses). Without it the block
   * starts FULL — `values.length` on the dynamic array, `values.length + 1`
   * on the heap — so a single insertion shows the growth. Sized from the
   * input, the SAME stack came out four cells wide on the slide that pushes
   * and five on the slide that pops — two consecutive slides drawing one
   * structure at two sizes (#294 review). Give the pair the same number and
   * the block stops breathing between slides.
   */
  capacity?: number;
  /** Lists only: draw a `tail` pointer and let the operations use it. */
  tail?: boolean;
  /** The iterative version of the operation beside the recursive one (`PAIRED`). */
  iterative?: boolean;
  /**
   * The program that runs the operation several times: `bst` × `insert`
   * from an empty tree, one frame per line instead of the method walked; or
   * `bst` × `remove` from the tree `values` builds, beside the method it
   * calls, walked for every removal.
   */
  program?: boolean;
  /**
   * The name the LISTING shows the method under, when the document presents
   * the structure through a TDA that calls it something else. A class that
   * has just taught `pop` = `deleteFirst` mounts the widget and the widget
   * says `deleteFirst`: the body is the pila's `pop` verbatim, and only the
   * name on it belongs to the structure rather than to the contract the
   * slide is about. Renames the signature and every call of it (#294).
   */
  method?: string;
  /**
   * The variable the calling program operates on. Default `list` on the
   * chains, `arreglo` on the dynamic array, `heap` on the heap.
   */
  receiver?: string;
  /**
   * The class the calling program constructs. Goes with `method` and
   * `receiver`: a slide that renamed `insertFirst` to `push` over a `pila`
   * still printed `LinkedList pila = new LinkedList();`, which contradicts
   * the `class Stack` the same document declared (#294).
   */
  receiverType?: string;
  /**
   * The dynamic array only: a named arrow kept on EVERY frame, aimed at the end the
   * operation works on — the last live slot for the `*-last` operations, the
   * first for the rest, and at nothing when the block is empty. The `i`/`j`
   * cursors a frame would otherwise carry are the operation's own, and they
   * vanish between runs; this is the structure's field, which the class
   * writes its contract in terms of (`top`, `front`, `rear`) and the reader
   * should watch move rather than take the narration's word for (#294).
   *
   * Naming one STANDS THE CURSORS DOWN: `i` lands on the same cell as `top`
   * and says the same thing with a second arrow.
   */
  pointer?: string;
}

const isList = (recipe: SequenceRecipe) => recipe.startsWith('linked-list');

/**
 * `insert-ordered` is a LIST operation in this course: the ordered list is
 * presented as a variant of the list, and the ordered array is not presented
 * at all. Offering it over the dynamic array would put a structure on the page
 * that no slide defines. Every other pair is valid.
 */
/**
 * Which operations each variant recipe has a listing FOR. The widget shows
 * Java the student may copy, so a combination is only valid when the listing
 * belongs to the structure the picture is drawing — and most of them do not:
 *
 * - On a ring, a walk that stops at `null` never stops. Only `insert-first`
 *   has a circular listing (it closes the ring again, and pays a walk for
 *   it); every other circular listing is still the open-chain one.
 * - On a doubly-linked chain, an operation that changes the shape has to fix
 *   BOTH links. Only `insert-first` and `remove-first` do; the read-only
 *   operations are fine because they change nothing, and `remove-last` is
 *   fine only in the `tail` form the class actually teaches.
 *
 * Refusing them is not a limitation to apologise for: it is the difference
 * between a widget that says "not defined here" to its AUTHOR and one that
 * prints wrong Java to a student. The review of #288 found the second.
 */
export const CIRCULAR_OPERATIONS: readonly SequenceOperation[] = ['insert-first'];
export const DOUBLY_OPERATIONS: readonly SequenceOperation[] = [
  'get-at',
  'search',
  'insert-first',
  'remove-first',
  'remove-last',
];

const HEAP_OPERATION_NAMES = ['insert', 'extract-max'] as const;
type HeapOperation = (typeof HEAP_OPERATION_NAMES)[number];
export const HEAP_OPERATIONS: readonly SequenceOperation[] = HEAP_OPERATION_NAMES;

/** The operations only `binary-tree` has (#321): the three visits and the height. */
const BINARY_TREE_ONLY_NAMES = ['preorder', 'inorder', 'postorder', 'height'] as const;

/**
 * The search trees' own operation (#322), which chooses a side at every node:
 * `bst` has it, and `avl` has it too, as the search tree's with `balance` on
 * the way back. It is "only" against every structure that is not a search
 * tree, which is what the refusal reasons ask — save the hash tables (#326),
 * which take a key out under the same name and are let through before the
 * trees' checks run.
 */
const BST_ONLY_NAMES = ['remove'] as const;
export const BST_ONLY_OPERATIONS: readonly SequenceOperation[] = BST_ONLY_NAMES;

/** The operations only `avl` has (#322): the rotations, its tool, simple and double. */
const AVL_ONLY_NAMES = [
  'rotate-right',
  'rotate-left',
  'rotate-left-right',
  'rotate-right-left',
] as const;
export const AVL_ONLY_OPERATIONS: readonly SequenceOperation[] = AVL_ONLY_NAMES;

/** The operations only a tree has; `search` and `insert` are shared. */
const TREE_OPERATION_NAMES = [
  ...BINARY_TREE_ONLY_NAMES,
  ...BST_ONLY_NAMES,
  ...AVL_ONLY_NAMES,
] as const;
type TreeOperation = (typeof TREE_OPERATION_NAMES)[number];
export const TREE_ONLY_OPERATIONS: readonly SequenceOperation[] = TREE_OPERATION_NAMES;

/** What `binary-tree` has a listing for: its own operations, and the shared `search`. */
const BINARY_TREE_OPERATION_NAMES = [...BINARY_TREE_ONLY_NAMES, 'search'] as const;
export type BinaryTreeOperation = (typeof BINARY_TREE_OPERATION_NAMES)[number];
export const BINARY_TREE_OPERATIONS: readonly SequenceOperation[] = BINARY_TREE_OPERATION_NAMES;

export function isBinaryTreeOperation(
  operation: SequenceOperation,
): operation is BinaryTreeOperation {
  return BINARY_TREE_OPERATIONS.includes(operation);
}

/** What `bst` has a listing for: its own operations, and the shared `search` and `insert`. */
const BST_OPERATION_NAMES = ['search', 'insert', 'inorder', ...BST_ONLY_NAMES] as const;
export type BstOperation = (typeof BST_OPERATION_NAMES)[number];
export const BST_OPERATIONS: readonly SequenceOperation[] = BST_OPERATION_NAMES;

export function isBstOperation(operation: SequenceOperation): operation is BstOperation {
  return BST_OPERATIONS.includes(operation);
}

/**
 * What `avl` has a listing for: its rotations, and the shared `insert` and
 * `remove`, which are the search tree's with a `balance` on the way back.
 */
const AVL_OPERATION_NAMES = [...AVL_ONLY_NAMES, 'insert', 'remove'] as const;
export type AvlOperation = (typeof AVL_OPERATION_NAMES)[number];
export const AVL_OPERATIONS: readonly SequenceOperation[] = AVL_OPERATION_NAMES;

export function isAvlOperation(operation: SequenceOperation): operation is AvlOperation {
  return AVL_OPERATIONS.includes(operation);
}

/**
 * What `hash-chaining` has a listing for (#326): the three operations of a
 * set of keys, as `contains`, `add` and `remove`, and the `resize` that `add`
 * calls when the table is full. `search` and `insert` share their names with
 * the chains and the trees, `remove` with the search trees; `resize` is the
 * table's alone.
 */
const HASH_CHAINING_OPERATION_NAMES = ['search', 'insert', 'remove', 'resize'] as const;
export type HashChainingOperation = (typeof HASH_CHAINING_OPERATION_NAMES)[number];
export const HASH_CHAINING_OPERATIONS: readonly SequenceOperation[] = HASH_CHAINING_OPERATION_NAMES;

export function isHashChainingOperation(
  operation: SequenceOperation,
): operation is HashChainingOperation {
  return HASH_CHAINING_OPERATIONS.includes(operation);
}

/** What `hash-probing` has a listing for (#326): `contains`, `add` and `remove`. */
const HASH_PROBING_OPERATION_NAMES = ['search', 'insert', 'remove'] as const;
export type HashProbingOperation = (typeof HASH_PROBING_OPERATION_NAMES)[number];
export const HASH_PROBING_OPERATIONS: readonly SequenceOperation[] = HASH_PROBING_OPERATION_NAMES;

export function isHashProbingOperation(
  operation: SequenceOperation,
): operation is HashProbingOperation {
  return HASH_PROBING_OPERATIONS.includes(operation);
}

export function isValidCombination(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  tail = false,
): boolean {
  if (recipe === 'hash-chaining') return HASH_CHAINING_OPERATIONS.includes(operation);
  if (recipe === 'hash-probing') return HASH_PROBING_OPERATIONS.includes(operation);
  if (operation === 'resize') return false;
  const heapOperation = HEAP_OPERATIONS.includes(operation);
  if (recipe === 'heap-max') return heapOperation;
  if (recipe === 'binary-tree') return BINARY_TREE_OPERATIONS.includes(operation);
  if (recipe === 'bst') return BST_OPERATIONS.includes(operation);
  if (recipe === 'avl') return AVL_OPERATIONS.includes(operation);
  if (heapOperation || TREE_ONLY_OPERATIONS.includes(operation)) return false;
  if (operation === 'binary-search') return recipe === 'dynamic-array';
  if (operation === 'insert-ordered' && !isList(recipe)) return false;
  if (recipe === 'linked-list-circular') return CIRCULAR_OPERATIONS.includes(operation);
  if (recipe === 'linked-list-doubly') {
    if (!DOUBLY_OPERATIONS.includes(operation)) return false;
    // Without `tail` the walk to the second-to-last node is the singly
    // listing, which never touches `prev`.
    return operation !== 'remove-last' || tail;
  }
  return true;
}

export function traceFor(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
  if (
    input.program === true &&
    !(
      ['bst', 'avl', 'hash-chaining', 'hash-probing'].includes(recipe) &&
      (operation === 'insert' || operation === 'remove')
    )
  ) {
    throw new Error(
      `Solo la inserción y la eliminación se muestran como programa: program va con eda="bst", "avl", "hash-chaining" o "hash-probing", y operation="insert" o "remove"; no con «${operation}».`,
    );
  }
  if (input.program === true && input.iterative === true) {
    throw new Error(
      'Un programa no lleva el listado iterativo al lado: el programa ocupa esa columna. Usa program o iterative, no los dos.',
    );
  }
  if (input.iterative === true && !PAIRED.some(([r, o]) => r === recipe && o === operation)) {
    throw new Error(
      `«${operation}» sobre «${recipe}» no tiene un listado iterativo al lado: iterative va con ${PAIRED.map(([r, o]) => `${r} × ${o}`).join(', ')}.`,
    );
  }
  if (!isValidCombination(recipe, operation, input.tail === true)) {
    throw new Error(`La operación «${operation}» no está definida sobre «${recipe}».`);
  }
  if (recipe === 'dynamic-array' && operation === 'binary-search' && input.iterative === true) {
    if (asRuns(input.target).length > 1) {
      throw new Error(
        'La búsqueda binaria con sus dos listados va con una sola búsqueda: el programa que llama a varias no tiene versión recursiva.',
      );
    }
    return pairListings(
      traceArray(operation, input),
      BINARY_SEARCH_RECURSIVE,
      BINARY_SEARCH_PAIRS,
      true,
    );
  }
  if (recipe === 'heap-max') return traceHeap(operation, input);
  if (recipe === 'binary-tree' && isBinaryTreeOperation(operation)) {
    return traceTree(operation, input);
  }
  if (recipe === 'bst' && isBstOperation(operation)) return traceSearchTree(operation, input);
  if (recipe === 'avl' && isAvlOperation(operation)) return traceAvl(operation, input);
  if (recipe === 'hash-chaining' && isHashChainingOperation(operation)) {
    const walked = traceHash(operation, input);
    return input.program === true
      ? hashProgram('ChainedHashTable', operation, input, walked)
      : walked;
  }
  if (recipe === 'hash-probing' && isHashProbingOperation(operation)) {
    const walked = traceProbe(operation, input);
    return input.program === true
      ? hashProgram('ProbingHashTable', operation, input, walked)
      : walked;
  }
  return isList(recipe) ? traceList(recipe, operation, input) : traceArray(operation, input);
}

/**
 * Insertions or removals on a hash table run by a program (#326 review, the
 * shape of the search trees' programs, #322): the program on the left — the
 * table created, the keys of `keys` added, one call per key of the run — and
 * the method it calls on the right, walked for every call the way a single
 * run walks it. The program's line stays lit while the method runs, so the
 * reader sees which call the method is in. A starting table with marks has
 * no program that writes it, short of removals the slide did not ask for.
 */
function hashProgram(
  type: 'ChainedHashTable' | 'ProbingHashTable',
  operation: 'insert' | 'remove' | 'search' | 'resize',
  input: SequenceInput,
  walked: SequenceTrace,
): SequenceTrace {
  if ((input.deleted ?? []).length > 0) {
    throw new Error(
      'Un programa arma su tabla con add, y una marca de deleted no sale de ahí: el programa empieza sin marcas.',
    );
  }
  const keys = input.keys ?? [];
  const runs = Array.isArray(input.key) ? input.key : [input.key];
  const call = operation === 'insert' ? 'add' : 'remove';
  const capacity = input.capacity ?? walked.hash?.buckets ?? walked.probe?.buckets;
  const built = 1 + keys.length;
  const code = [
    `${type} names = new ${type}(${capacity});`,
    ...keys.map((k) => `names.add("${k}");`),
    ...runs.map((k) => `names.${call}("${k}");`),
  ].join('\n');
  const first = walked.steps[0]!;
  const opening: SequenceStep = {
    ...first,
    kind: 'start',
    highlightLines: Array.from({ length: built }, (_, i) => i + 1),
    alongsideLines: [],
    description:
      keys.length === 0
        ? `La tabla, vacía: ${capacity} posiciones.`
        : `La tabla, con las ${keys.length} claves que el programa agregó.`,
    ...(first.hash ? { hash: { ...first.hash, key: '', bucket: null, pointers: [] } } : {}),
    ...(first.probe ? { probe: { ...first.probe, key: '', home: null, at: null } } : {}),
  };
  // A run starts where the method is called, at its public method's frame.
  let run = -1;
  const steps = walked.steps.map((step) => {
    if (step.kind === 'start') run += 1;
    return { ...step, highlightLines: [built + run + 1], alongsideLines: step.highlightLines };
  });
  return {
    ...walked,
    code,
    alongside: walked.code,
    listingNames: ['programa', 'método'],
    steps: [opening, ...steps],
  };
}

// ── shared helpers ────────────────────────────────────────────────────────

let nextId = 0;
const cellsFrom = (values: number[]): SequenceCell[] =>
  values.map((value) => ({ id: (nextId += 1), value, state: 'idle' as const }));

const snapshot = (cells: SequenceCell[]): SequenceCell[] => cells.map((c) => ({ ...c }));

/**
 * Clears the IN-FLIGHT paint states on the final frame — the ones that mean
 * "the algorithm is looking at this right now". `new` and `found` survive: the
 * last frame of an insertion is exactly where the reader should still see
 * which node was added, and the last frame of a search where the hit was.
 */
const settle = (cells: SequenceCell[]): SequenceCell[] =>
  cells.map((c) =>
    // `discarded` stays: the last frame of a binary search is what it ruled
    // out, and an array that turns idle again says it never looked.
    c.state === 'new' || c.state === 'found' || c.state === 'discarded'
      ? { ...c }
      : { ...c, state: 'idle' as const },
  );

/**
 * The binary search's cursors, ordered by position, with one label for
 * cursors that share a cell: three arrows on one box draw three labels on top
 * of each other. A cursor past either end of the block (`hi = -1` once
 * everything is ruled out on the left) has no box to point at and is left
 * out; the narration still says where it stopped.
 */
function rangeCursors(lo: number, hi: number, mid?: number): SequencePointer[] {
  const named: [string, number][] = [
    ['lo', lo],
    ...(mid === undefined ? [] : [['mid', mid] as [string, number]]),
    ['hi', hi],
  ];
  const byIndex = new Map<number, string[]>();
  for (const [name, index] of named) {
    if (index < 0) continue;
    byIndex.set(index, [...(byIndex.get(index) ?? []), name]);
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, names]) => ({ name: names.join(', '), index }));
}

function checkIndex(i: number | undefined, length: number, inclusive: boolean): number {
  const max = inclusive ? length : length - 1;
  if (i === undefined || !Number.isInteger(i) || i < 0 || i > max) {
    throw new Error(`El índice ${i ?? '(ausente)'} está fuera del rango válido [0, ${max}].`);
  }
  return i;
}

/**
 * Refuses a slide that would run a removal more times than the chain has
 * nodes — the listing throws `NoSuchElementException` there, and a trace that
 * ran anyway would be animating an exception. Addressed to the AUTHOR, at
 * boot, like every other authoring guard.
 */
function requireRoom(runs: number, length: number, method: string): void {
  if (runs > length) {
    throw new Error(
      `La cadena tiene ${length} nodo${length === 1 ? '' : 's'} y ${method} se ejecuta ${runs} veces: la última correría sobre una lista vacía.`,
    );
  }
}

function requireNonEmpty(values: number[]): void {
  if (values.length === 0) {
    throw new Error('La estructura está vacía: no hay elemento que eliminar.');
  }
}

function requireValues(input: SequenceInput): number[] {
  if (input.value === undefined) throw new Error('Falta el valor a insertar.');
  const list = Array.isArray(input.value) ? input.value : [input.value];
  if (list.length === 0) throw new Error('La lista de valores a insertar está vacía.');
  return list;
}

/**
 * The name the listing is shown under: the structure's own by default, or
 * the document's when it presents the structure through a TDA (`method`).
 * Applied to the listing's signature and to the program that drives it, so
 * the two never disagree.
 */
function shownName(operation: SequenceOperation, input: SequenceInput): string {
  return input.method ?? METHOD_NAME[operation];
}

/** Renames the method in a listing whose signature carries the default name. */
function renameIn(code: string, operation: SequenceOperation, shown: string): string {
  const own = METHOD_NAME[operation];
  return shown === own ? code : code.split(`${own}(`).join(`${shown}(`);
}

/** The Java name of each operation, for the program that drives it. */
const METHOD_NAME: Record<SequenceOperation, string> = {
  'get-at': 'getAt',
  'insert-first': 'insertFirst',
  'insert-last': 'insertLast',
  'insert-at': 'insertAt',
  'insert-ordered': 'insertOrdered',
  insert: 'insert',
  'extract-max': 'extractMax',
  'remove-first': 'deleteFirst',
  'remove-last': 'deleteLast',
  'remove-at': 'deleteAt',
  search: 'search',
  'binary-search': 'binarySearch',
  preorder: 'preorder',
  inorder: 'inorder',
  postorder: 'postorder',
  height: 'height',
  remove: 'remove',
  'rotate-right': 'rotateRight',
  'rotate-left': 'rotateLeft',
  'rotate-left-right': 'rotateLeftRight',
  'rotate-right-left': 'rotateRightLeft',
  resize: 'resize',
};

// ── the array family ──────────────────────────────────────────────────────

/** The operations the dynamic array has a listing for. */
type ArrayOperation = Exclude<
  SequenceOperation,
  'insert-ordered' | HeapOperation | TreeOperation | 'remove' | 'resize'
>;

const ARRAY_CODE: Record<ArrayOperation, string> = {
  'get-at': `int getAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
    }
    return data[i];
}`,
  'insert-first': `void insertFirst(int x) {
    if (size == data.length) {
        resize(2 * data.length);
    }
    for (int j = size; j > 0; j--) {
        data[j] = data[j - 1];
    }
    data[0] = x;
    size++;
}`,
  'insert-last': `void insertLast(int x) {
    if (size == data.length) {
        resize(2 * data.length);
    }
    data[size] = x;
    size++;
}`,
  'insert-at': `void insertAt(int i, int x) {
    if (i < 0 || i > size) {
        throw new IndexOutOfBoundsException();
    }
    if (size == data.length) {
        resize(2 * data.length);
    }
    for (int j = size; j > i; j--) {
        data[j] = data[j - 1];
    }
    data[i] = x;
    size++;
}`,
  'remove-first': `int deleteFirst() {
    if (size == 0) {
        throw new NoSuchElementException();
    }
    int x = data[0];
    for (int j = 0; j < size - 1; j++) {
        data[j] = data[j + 1];
    }
    size--;
    return x;
}`,
  'remove-last': `int deleteLast() {
    if (size == 0) {
        throw new NoSuchElementException();
    }
    int x = data[size - 1];
    size--;
    return x;
}`,
  'remove-at': `int deleteAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
    }
    int x = data[i];
    for (int j = i; j < size - 1; j++) {
        data[j] = data[j + 1];
    }
    size--;
    return x;
}`,
  search: `int search(int x) {
    for (int i = 0; i < size; i++) {
        if (data[i] == x) {
            return i;
        }
    }
    return -1;
}`,
  'binary-search': `int binarySearch(int x) {
    int lo = 0;
    int hi = size - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (data[mid] == x) {
            return mid;
        }
        if (x < data[mid]) {
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return -1;
}`,
};

/**
 * The operations that can show a second listing beside their own, the
 * recursive version on the left and the iterative on the right (#322): the
 * ones whose two versions take the same decisions in the same order, so a
 * frame is the same moment in both.
 */
const PAIRED: [SequenceRecipe, SequenceOperation][] = [
  ['dynamic-array', 'binary-search'],
  ['bst', 'search'],
  ['bst', 'insert'],
];

/** The binary search written recursively: one call per range, as divide and conquer writes it. */
const BINARY_SEARCH_RECURSIVE = `int binarySearch(int x) {
    return binarySearch(x, 0, size - 1);
}

int binarySearch(int x, int lo, int hi) {
    if (lo > hi) {
        return -1;
    }
    int mid = (lo + hi) / 2;
    if (data[mid] == x) {
        return mid;
    }
    if (x < data[mid]) {
        return binarySearch(x, lo, mid - 1);
    }
    return binarySearch(x, mid + 1, hi);
}`;

/** The iterative listing's lines, read as the recursive one's. */
const BINARY_SEARCH_PAIRS: ListingPairs = [
  ['int lo = 0', ['return binarySearch(x, 0, size - 1)']],
  ['int hi = size - 1', ['return binarySearch(x, 0, size - 1)']],
  ['while (lo <= hi)', ['if (lo > hi)']],
  ['int mid =', ['int mid =']],
  ['if (data[mid] == x)', ['if (data[mid] == x)']],
  ['return mid;', ['return mid;']],
  ['if (x < data[mid])', ['if (x < data[mid])']],
  ['hi = mid - 1', ['return binarySearch(x, lo, mid - 1)']],
  ['lo = mid + 1', ['return binarySearch(x, mid + 1, hi)']],
  ['return -1;', ['return -1;']],
];

function traceArray(operation: SequenceOperation, input: SequenceInput): SequenceTrace {
  // How many times the author asked for the operation. The array family
  // animated ONE run through #288 and through #294's first array slides; the
  // push slide of the second pass needs four, with the block filling on the
  // third. Same helper as the list side, so `insertAt` still gets one index
  // per value and the run ceiling is one number for the whole widget.
  const args = runArgs(operation, input);
  // Same resguardo the list family carries: a zero-length argument list
  // traces nothing, and `steps.at(-1)!` at the settle step turns that into an
  // English JS message rendered to the page.
  if (args.length === 0) {
    throw new Error('La operación no se ejecuta ninguna vez: falta el argumento que la corre.');
  }
  requireRuns(args.length);
  // A binary search on an unsorted array answers wrongly with no error, which
  // is the one thing a slide must never show; a repeated value has no single
  // position to find. Same refusal `insertOrdered` makes on a list.
  if (
    operation === 'binary-search' &&
    input.values.some((v, i) => i > 0 && v <= input.values[i - 1]!)
  ) {
    throw new Error(
      'La búsqueda binaria necesita el arreglo ordenado de menor a mayor, sin valores repetidos.',
    );
  }
  const shown = shownName(operation, input);
  const base = renameIn(ARRAY_CODE[operation as ArrayOperation], operation, shown);
  const many = args.length > 1;
  const code = many
    ? base +
      callingProgram(args, shown, false, {
        name: input.receiver ?? 'arreglo',
        type: input.receiverType ?? 'DynamicArray',
      })
    : base;
  const runLine = (run: number): number[] => (many ? [base.split('\n').length + run + 1] : []);
  // The block DEFAULTS to full, so that a single insertion shows the resize
  // the dynamic array exists for; an author running several insertions passes
  // `capacity` to choose which of them pays for the growth, because a first
  // push that grows is the one place a reader least expects it.
  if (input.capacity !== undefined) {
    // Refuse what cannot be drawn rather than degrading quietly: a fractional
    // capacity was truncated in silence and `NaN` produced a zero-width block.
    if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > MAX_CAPACITY) {
      throw new Error(`La capacidad ${input.capacity} no es un entero entre 1 y ${MAX_CAPACITY}.`);
    }
    if (input.capacity < input.values.length) {
      throw new Error(
        `La capacidad ${input.capacity} no alcanza para los ${input.values.length} elementos iniciales.`,
      );
    }
  }
  let capacity = input.capacity ?? Math.max(input.values.length, 1);

  // The block, slot by slot. A copy leaves its source written where it was
  // until the next one overwrites it, so the reader sees the value in two
  // cells at once and counts the copies — which is the whole lesson of an
  // array insertion. (It used to vacate the source, which drew a MOVE and a
  // hole travelling through the middle of the block — #294 review.)
  const slots: (SequenceCell | null)[] = Array.from({ length: capacity }, () => null);
  cellsFrom(input.values).forEach((cell, i) => {
    slots[i] = cell;
  });
  const live = (): SequenceCell[] => slots.filter((s): s is SequenceCell => s !== null);
  /** Index of the last occupied slot, + 1 — the array's `size`. */
  const size = (): number => {
    let n = 0;
    slots.forEach((s, i) => {
      if (s !== null) n = i + 1;
    });
    return n;
  };

  const steps: SequenceStep[] = [];
  let cost = 0;
  // The value the running search looks for, written beside the block.
  let seekNow: number | undefined;
  // Which call is running, so every frame lights BOTH the line inside the
  // method and the call that invoked it — the two halves of "where are we"
  // the list family already prints.
  let currentRun = 0;
  // The persistent pointer, if the slide asked for one. Computed at each
  // `push` rather than once, so it follows `size` through the frames instead
  // of freezing where the structure started.
  const atLast = operation.endsWith('-last');
  const basePointers = (): SequencePointer[] => {
    if (input.pointer === undefined) return [];
    const n = size();
    return [{ name: input.pointer, index: n === 0 ? null : atLast ? n - 1 : 0, fixed: true }];
  };
  const push = (
    kind: SequenceStepKind,
    highlightLines: number[],
    description: string,
    extra: Partial<SequenceStep> = {},
  ) => {
    const { pointers: extraPointers, ...rest } = extra;
    // Naming a pointer is the author saying what the reader should follow, so
    // the operation's own cursor stands down: `i` lands on the same cell as
    // `top` and says the same thing with a second arrow. A slide that names
    // none keeps the cursors — the Queue act reads `j` through the shift.
    const cursors = input.pointer === undefined ? (extraPointers ?? []) : [];
    steps.push({
      kind,
      cells: snapshot(live()),
      slots: slots.map((s) => (s === null ? null : { ...s })),
      pointers: [...basePointers(), ...cursors],
      highlightLines: [...highlightLines, ...runLine(currentRun)],
      description,
      capacity,
      cost,
      ...(seekNow === undefined ? {} : { seek: seekNow }),
      ...rest,
    });
  };

  const clearTransient = () => {
    slots.forEach((s, i) => {
      if (s !== null && s.state === 'active') slots[i] = { ...s, state: 'idle' };
    });
  };

  const growIfNeeded = (): number => {
    // Only when the block is actually full.
    if (live().length < capacity) return 0;
    const copied = live().length;
    capacity = capacity * 2;
    while (slots.length < capacity) slots.push(null);
    cost += copied;
    push(
      'grow',
      [lineOf(code, 'size == data.length'), lineOf(code, 'resize(')],
      `El bloque está lleno: se reserva uno del doble (${capacity}) y se copian los ${copied} elementos.`,
    );
    return 3;
  };

  // One pass per run. Everything the pass needs — `slots`, `capacity`,
  // `cost`, `push` — is closed over, so a second run starts on the block
  // the first one left rather than on the author's `values`. The array
  // family animated ONE run before #294: a slide that asked for three got
  // one, silently, which is why it was refused at boot. It is honoured now.
  args.forEach((_arg, run) => {
    // Each call starts its own count; see `SequenceStep.cost`.
    currentRun = run;
    if (run > 0) cost = 0;
    switch (operation) {
      case 'insert-first':
      case 'insert-last':
      case 'insert-at': {
        const x = requireValues(input)[run]!;
        const at =
          operation === 'insert-first'
            ? 0
            : operation === 'insert-last'
              ? size()
              : checkIndex(asRuns(input.index)[run], size(), true);
        growIfNeeded();
        const n = size();
        // Parked over the slot it will land in, like the list family's
        // back-growing operations. It used to sit at a fixed offset from the
        // front of the block, which put it over the middle of a short block
        // — where it crossed the `top` arrow's line (#294).
        const floating = { value: x, label: 'x', slot: at };
        push(
          'start',
          [1],
          `Insertamos ${x} en la posición ${at} de un arreglo de ${n} elementos.`,
          { carry: floating },
        );
        // Copy right, from the last element down to the insertion point. The
        // source stays drawn (stale) for its frame — see the mirror comment in
        // the removal branch — and each is overwritten by the next copy, the
        // last one by the value being inserted.
        const shiftLines =
          operation === 'insert-last'
            ? []
            : [lineOf(code, 'for (int j = size'), lineOf(code, 'data[j] = data[j - 1]')];
        for (let j = n; j > at; j -= 1) {
          cost += 1;
          const moved = slots[j - 1]!;
          slots[j] = { ...moved, state: 'active' };
          slots[j - 1] = { id: (nextId += 1), value: moved.value, state: 'stale' };
          push('shift', shiftLines, `Copiamos ${moved.value} de la posición ${j - 1} a la ${j}.`, {
            pointers: [{ name: 'j', index: j }],
            carry: floating,
          });
          clearTransient();
        }
        cost += 1;
        slots[at] = { id: (nextId += 1), value: x, state: 'new' };
        const writeLine = lineOf(
          code,
          operation === 'insert-last'
            ? 'data[size] = x'
            : operation === 'insert-first'
              ? 'data[0] = x'
              : 'data[i] = x',
        );
        push(
          'link',
          [writeLine],
          `Escribimos ${x} en la posición ${at}. El largo pasa a ${size()}.`,
          {
            pointers: [{ name: 'i', index: at }],
          },
        );
        break;
      }
      case 'remove-first':
      case 'remove-last':
      case 'remove-at': {
        // The block as it is BY NOW, not as the author wrote it: a third
        // removal is refused against what the two before it left.
        requireNonEmpty(live().map((c) => c.value));
        const n = size();
        const at =
          operation === 'remove-first'
            ? 0
            : operation === 'remove-last'
              ? n - 1
              : checkIndex(asRuns(input.index)[run], n, false);
        const removed = slots[at]!;
        slots[at] = { ...removed, state: 'leaving' };
        cost += 1;
        push(
          'start',
          [lineOf(code, 'int x = data[')],
          `Guardamos ${removed.value}, el elemento de la posición ${at}.`,
          {
            pointers: [{ name: 'i', index: at }],
          },
        );
        slots[at] = null;
        // Copy left, closing the hole the removal opened.
        const shiftLines =
          operation === 'remove-last'
            ? []
            : [lineOf(code, 'for (int j = '), lineOf(code, 'data[j] = data[j + 1]')];
        for (let j = at; j < n - 1; j += 1) {
          cost += 1;
          const moved = slots[j + 1]!;
          slots[j] = { ...moved, state: 'active' };
          // A COPY does not empty its source. Leaving the source drawn — marked
          // stale — is what makes the frame say "copy" instead of "move": the
          // reader sees the value in two cells at once. The next iteration
          // overwrites it, and the last source is nulled after the loop, which
          // is the one that becomes garbage beyond `size`. Emptying it here
          // drew a hole travelling through the middle of the block, which is
          // the picture #277 teaches as the INVALID array (#294 review).
          slots[j + 1] = { id: (nextId += 1), value: moved.value, state: 'stale' };
          push('shift', shiftLines, `Copiamos ${moved.value} de la posición ${j + 1} a la ${j}.`, {
            pointers: [{ name: 'j', index: j }],
          });
          clearTransient();
        }
        if (n - 1 > at) slots[n - 1] = null;
        push(
          'done',
          [lineOf(code, 'size--')],
          `El largo pasa a ${size()}. Devolvemos ${removed.value}.`,
        );
        break;
      }
      case 'get-at': {
        const at = checkIndex(asRuns(input.index)[run], size(), false);
        push('start', [lineOf(code, 'i >= size')], `Pedimos el elemento de la posición ${at}.`);
        cost += 1;
        slots[at] = { ...slots[at]!, state: 'found' };
        push(
          'found',
          [lineOf(code, 'return data[i]')],
          `La posición ${at} vive en base + ${at} × tamaño: una cuenta, y ya estamos ahí.`,
          { pointers: [{ name: 'i', index: at }] },
        );
        break;
      }
      case 'search': {
        // `runArgs` returns `asRuns(input.target)` for this operation and an
        // empty one throws upstream, so every run has its own target.
        const target = asRuns(input.target)[run]!;
        const n = size();
        push(
          'start',
          [lineOf(code, 'for (int i = 0')],
          `Buscamos ${target} recorriendo el arreglo desde la posición 0.`,
        );
        let found = -1;
        for (let j = 0; j < n; j += 1) {
          cost += 1;
          const cell = slots[j]!;
          const hit = cell.value === target;
          slots[j] = { ...cell, state: hit ? 'found' : 'active' };
          push(
            'compare',
            [lineOf(code, 'for (int i = 0'), lineOf(code, 'if (data[i] == x')],
            `¿data[${j}] = ${cell.value} es ${target}? ${hit ? 'Sí.' : 'No.'}`,
            {
              pointers: [{ name: 'j', index: j }],
            },
          );
          if (hit) {
            found = j;
            break;
          }
          clearTransient();
        }
        push(
          found >= 0 ? 'found' : 'done',
          found >= 0 ? [lineOf(code, 'return i;')] : [lineOf(code, 'return -1;')],
          found >= 0
            ? `Encontramos ${target} en la posición ${found}.`
            : `Recorrimos las ${n} posiciones: ${target} no está en el arreglo.`,
        );
        break;
      }
      case 'binary-search': {
        const x = asRuns(input.target)[run]!;
        seekNow = x;
        const n = size();
        // A second search starts on the whole block: what the first one ruled
        // out says nothing about the next value.
        slots.forEach((cell, i) => {
          if (cell !== null) slots[i] = { ...cell, state: 'idle' };
        });
        let lo = 0;
        let hi = n - 1;
        push(
          'start',
          [lineOf(code, 'int lo = 0'), lineOf(code, 'int hi = size - 1')],
          `Buscamos ${x}. Lo que queda por revisar va de lo = 0 a hi = ${hi}: el arreglo entero.`,
          { pointers: rangeCursors(lo, hi) },
        );
        let found = -1;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const cell = slots[mid]!;
          slots[mid] = { ...cell, state: 'active' };
          cost += 1;
          push(
            'walk',
            [lineOf(code, 'while (lo <= hi)'), lineOf(code, 'int mid =')],
            `lo = ${lo} ≤ hi = ${hi}: queda algo por revisar. El medio es (${lo} + ${hi}) / 2 = ${mid}.`,
            { pointers: rangeCursors(lo, hi, mid) },
          );
          if (cell.value === x) {
            slots[mid] = { ...cell, state: 'found' };
            push(
              'found',
              [lineOf(code, 'if (data[mid] == x)'), lineOf(code, 'return mid;')],
              `¿data[${mid}] = ${cell.value} es ${x}? Sí: está en la posición ${mid}.`,
              { pointers: rangeCursors(lo, hi, mid) },
            );
            found = mid;
            break;
          }
          push(
            'compare',
            [lineOf(code, 'if (data[mid] == x)')],
            `¿data[${mid}] = ${cell.value} es ${x}? No.`,
            { pointers: rangeCursors(lo, hi, mid) },
          );
          // One comparison rules out the middle and the whole half on the
          // side the value cannot be: the cells fade and stay faded.
          const [from, to] = x < cell.value ? [mid, hi] : [lo, mid];
          for (let i = from; i <= to; i += 1) slots[i] = { ...slots[i]!, state: 'discarded' };
          if (x < cell.value) {
            hi = mid - 1;
            push(
              'walk',
              [lineOf(code, 'if (x < data[mid])'), lineOf(code, 'hi = mid - 1')],
              `${x} < ${cell.value}: ${x} no puede estar de la posición ${mid} en adelante. Esa parte queda descartada, y hi = ${hi}.`,
              { pointers: rangeCursors(lo, hi, mid) },
            );
          } else {
            lo = mid + 1;
            push(
              'walk',
              [lineOf(code, 'if (x < data[mid])'), lineOf(code, 'lo = mid + 1')],
              `${x} > ${cell.value}: ${x} no puede estar de la posición ${mid} hacia atrás. Esa parte queda descartada, y lo = ${lo}.`,
              { pointers: rangeCursors(lo, hi, mid) },
            );
          }
        }
        if (found < 0) {
          push(
            'done',
            [lineOf(code, 'while (lo <= hi)'), lineOf(code, 'return -1;')],
            `lo = ${lo} > hi = ${hi}: no queda nada por revisar. ${x} no está, y lo quedó en ${lo}: la posición donde iría.`,
            { pointers: rangeCursors(lo, hi) },
          );
        }
        break;
      }
      default:
        throw new Error(`Operación no soportada sobre un arreglo: ${operation}`);
    }
  });

  const last = steps.at(-1)!;
  steps[steps.length - 1] = {
    ...last,
    cells: settle(last.cells),
    slots: (last.slots ?? []).map((s) => (s === null ? null : settle([s])[0]!)),
  };
  return {
    steps,
    code,
    maxCells: Math.max(...steps.map((f) => f.cells.length)),
    align: 'left',
    hasCarry: steps.some((f) => f.carry !== undefined),
  };
}

// ── the list family ───────────────────────────────────────────────────────

/**
 * The listings differ by recipe where the CODE differs, and only there: the
 * doubly-linked recipe maintains `prev`, and the circular recipe terminates
 * its walks on `head` rather than on `null`. Everything else is shared, which
 * is the point the class makes — the operations are the same, what changes is
 * where the cost lives.
 */
/**
 * The program that drives the operation, appended under the method when a
 * slide inserts several values. Without it the reader watches three identical
 * runs of one method with no way to tell which call is running; with it, the
 * frame lights the call AND the line inside the method, so both halves of
 * "where are we" are on screen.
 */
function callingProgram(
  args: string[],
  method: string,
  fresh: boolean,
  receiver: { name: string; type: string } = { name: 'list', type: 'LinkedList' },
): string {
  return [
    '',
    // Only a structure that STARTS empty was built by this program. Printing
    // the constructor over a populated `values` would be a listing that
    // contradicts the picture beside it.
    ...(fresh ? [`${receiver.type} ${receiver.name} = new ${receiver.type}();`] : []),
    ...args.map((a) => `${receiver.name}.${method}(${a});`),
  ].join('\n');
}

/**
 * The arguments each run of `operation` is called with, as they are written
 * in Java. One entry per run: `['5', '1']` is two calls, `['', '']` two calls
 * that take none. Empty when the author asked for a single run, which is what
 * suppresses the driving program.
 */
function runArgs(operation: SequenceOperation, input: SequenceInput): string[] {
  switch (operation) {
    case 'insert-first':
    case 'insert-last':
    case 'insert':
      return asRuns(input.value).map(String);
    case 'insert-at': {
      const values = asRuns(input.value);
      const indices = asRuns(input.index);
      if (values.length !== indices.length) {
        throw new Error(
          `insertAt necesita un índice por cada valor: ${values.length} valores y ${indices.length} índices.`,
        );
      }
      return values.map((v, i) => `${indices[i]}, ${v}`);
    }
    case 'get-at':
    case 'remove-at':
      return asRuns(input.index).map(String);
    case 'search':
    case 'binary-search':
      return asRuns(input.target).map(String);
    case 'remove-first':
    case 'remove-last':
    case 'extract-max': {
      const times = input.times ?? 1;
      requireRuns(times);
      return Array.from({ length: times }, () => '');
    }
    case 'insert-ordered':
      return asRuns(input.target).map(String);
    // A traversal or a height runs once over the whole tree and takes no argument.
    case 'preorder':
    case 'inorder':
    case 'postorder':
    case 'height':
    case 'remove':
    case 'rotate-right':
    case 'rotate-left':
    case 'rotate-left-right':
    case 'rotate-right-left':
      return [];
    // The hash table drives no program of its own: its key is the run
    // (`remove` is above, with the search trees').
    case 'resize':
      return [];
  }
}

function listCode(recipe: SequenceRecipe, operation: SequenceOperation, tail: boolean): string {
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  const end = circular ? 'current.next != head' : 'current.next != null';

  switch (operation) {
    case 'insert-first':
      // The circular recipe cannot share the open-chain listing: the node
      // that used to point at `head` is the LAST one, and on a ring it still
      // exists. Left unchanged it points at the old first node and the ring
      // is broken — the invariant the slide introducing the variant states.
      // Finding it is a walk, so the ring costs this operation its Θ(1).
      if (circular) {
        return `void insertFirst(int x) {
    Node fresh = new Node(x);
    if (head == null) {
        fresh.next = fresh;
    } else {
        Node last = head;
        while (last.next != head) {
            last = last.next;
        }
        fresh.next = head;
        last.next = fresh;
    }
    head = fresh;
    size++;
}`;
      }
      return doubly
        ? `void insertFirst(int x) {
    Node fresh = new Node(x);
    fresh.next = head;
    if (head != null) head.prev = fresh;
    head = fresh;
    size++;
}`
        : `void insertFirst(int x) {
    Node fresh = new Node(x);
    fresh.next = head;
    head = fresh;
    size++;
}`;
    case 'insert-last':
      // Both variants branch on the empty chain first: with no nodes there is
      // no last node to link to, and the previous listing dereferenced `head`
      // without asking. One `size++` at the end, not one per branch, so no
      // fragment of this listing appears twice — `lineOf` names lines by text.
      return tail
        ? `void insertLast(int x) {
    Node fresh = new Node(x);
    if (head == null) {
        head = fresh;
    } else {
        tail.next = fresh;
    }
    tail = fresh;
    size++;
}`
        : `void insertLast(int x) {
    Node fresh = new Node(x);
    if (head == null) {
        head = fresh;
    } else {
        Node current = head;
        while (${end}) {
            current = current.next;
        }
        current.next = fresh;
    }
    size++;
}`;
    case 'insert-at':
      // Position 0 has no previous node to modify, and the walk below cannot
      // produce one: `prev` would still be `head` and the insertion would
      // land in the wrong place. The branch delegates to the operation that
      // is defined there, which is also how the reader should think of it.
      return `void insertAt(int i, int x) {
    if (i < 0 || i > size) {
        throw new IndexOutOfBoundsException();
    }
    if (i == 0) {
        insertFirst(x);
        return;
    }
    Node fresh = new Node(x);
    Node prev = head;
    for (int j = 0; j < i - 1; j++) {
        prev = prev.next;
    }
    fresh.next = prev.next;
    prev.next = fresh;
    size++;
}`;
    case 'insert-ordered':
      // The walk looks at `prev.next`, so it can never place a value that
      // belongs BEFORE the first node: `prev` would still be `head` and the
      // value would land second. The front is a case of its own, and it is
      // the operation the front already has.
      return `void insertOrdered(int x) {
    if (head == null || x <= head.value) {
        insertFirst(x);
        return;
    }
    Node fresh = new Node(x);
    Node prev = head;
    while (prev.next != null && prev.next.value < x) {
        prev = prev.next;
    }
    fresh.next = prev.next;
    prev.next = fresh;
    size++;
}`;
    case 'remove-first':
      return doubly
        ? `int deleteFirst() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old = head;
    head = head.next;
    if (head != null) head.prev = null;
    size--;
    return old.value;
}`
        : `int deleteFirst() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old = head;
    head = head.next;${
      tail
        ? `
    if (head == null) {
        tail = null;
    }`
        : ''
    }
    size--;
    return old.value;
}`;
    case 'remove-last':
      // A chain of ONE has no second-to-last node, and both bodies below
      // assume there is one: `prev.next.next` dereferences `null`, and
      // `tail.prev` walks off the front. The branch is the guard, and one
      // `size--` at the end keeps every fragment of the listing unique —
      // `lineOf` names lines by text.
      return doubly && tail
        ? `int deleteLast() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old = tail;
    if (head == tail) {
        head = null;
        tail = null;
    } else {
        tail = tail.prev;
        tail.next = null;
    }
    size--;
    return old.value;
}`
        : `int deleteLast() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old;
    if (head.next == null) {
        old = head;
        head = null;${
          tail
            ? `
        tail = null;`
            : ''
        }
    } else {
        Node prev = head;
        while (prev.next.next != null) {
            prev = prev.next;
        }
        old = prev.next;
        prev.next = null;${
          tail
            ? `
        tail = prev;`
            : ''
        }
    }
    size--;
    return old.value;
}`;
    case 'remove-at':
      // Same hole as insertAt's, and the same branch: at position 0 there is
      // no previous node, so `deleteFirst` is what the operation means there.
      return `int deleteAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
    }
    if (i == 0) {
        return deleteFirst();
    }
    Node prev = head;
    for (int j = 0; j < i - 1; j++) {
        prev = prev.next;
    }
    Node old = prev.next;
    prev.next = old.next;
    size--;
    return old.value;
}`;
    case 'get-at':
      return `int getAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
    }
    Node current = head;
    for (int j = 0; j < i; j++) {
        current = current.next;
    }
    return current.value;
}`;
    case 'search':
      return `int search(int x) {
    Node current = head;
    for (int i = 0; current != null; i++) {
        if (current.value == x) {
            return i;
        }
        current = current.next;
    }
    return -1;
}`;
    // Unreachable: `isValidCombination` never pairs a list with these.
    case 'insert':
    case 'extract-max':
      throw new Error(`«${operation}» es una operación del heap, no de una lista.`);
    case 'preorder':
    case 'inorder':
    case 'postorder':
    case 'height':
    case 'rotate-right':
    case 'rotate-left':
    case 'rotate-left-right':
    case 'rotate-right-left':
      throw new Error(`«${operation}» es una operación de árbol, no de una lista.`);
    case 'remove':
      throw new Error(
        '«remove» es una operación de los árboles de búsqueda y de la tabla hash, no de una lista.',
      );
    case 'binary-search':
      throw new Error(
        'La búsqueda binaria necesita llegar a la posición del medio en un paso: es del arreglo, no de una lista.',
      );
    case 'resize':
      throw new Error(`«${operation}» es una operación de la tabla hash, no de una lista.`);
  }
}

/**
 * The widest block a slide can still show, in the same spirit as the runs cap
 * (`requireRuns`, `sequenceStepperTraceShared.ts`):
 * past this nobody reads the cells projected, and an author who asks for it
 * has almost certainly typed a number they did not mean.
 */
const MAX_CAPACITY = 40;

function traceList(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
  const tail = input.tail === true;
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  // How many times the author asked for the operation, and the program that
  // drives it. A single run keeps the listing alone — the widget shows one
  // operation and the slide's prose does the talking. Several runs append the
  // calls, so every frame lights BOTH the line inside the method and the call
  // that is running, and the reader can see which run they are watching.
  const shown = shownName(operation, input);
  const base = renameIn(listCode(recipe, operation, tail), operation, shown);
  const args = runArgs(operation, input);
  requireRuns(args.length);
  // A zero-length argument list traces nothing, and `steps.at(-1)!` at the
  // settle step turns that into an English JS message rendered to the page.
  if (args.length === 0) {
    throw new Error('La operación no se ejecuta ninguna vez: falta el argumento que la corre.');
  }
  const many = args.length > 1;
  const fresh = input.values.length === 0;
  const code = many
    ? base +
      callingProgram(args, shown, fresh, {
        name: input.receiver ?? 'list',
        type: input.receiverType ?? 'LinkedList',
      })
    : base;
  // Computed, not searched: two runs of a method that takes no argument write
  // the SAME call line twice, and `lineOf` would hand both the first one.
  // Each call starts its own count; see `SequenceStep.cost`.
  const startRun = (): void => {
    cost = 0;
  };
  const runLine = (run: number): number[] =>
    many ? [base.split('\n').length + (fresh ? 1 : 0) + run + 1] : [];
  // How wide the drawing will get, so an operation that grows at the FRONT
  // can park its floating node over the slot it is about to occupy.
  const maxSlots = input.values.length + (operation.startsWith('insert') ? args.length : 0);
  const cells = cellsFrom(input.values);
  const steps: SequenceStep[] = [];
  let cost = 0;

  const basePointers = (extra: SequencePointer[] = []): SequencePointer[] => {
    const pointers: SequencePointer[] = [
      { name: 'head', index: cells.length > 0 ? 0 : null, fixed: true },
    ];
    if (tail) {
      pointers.push({
        name: 'tail',
        index: cells.length > 0 ? cells.length - 1 : null,
        fixed: true,
      });
    }
    return [...pointers, ...extra];
  };

  const push = (
    kind: SequenceStepKind,
    highlightLines: number[],
    description: string,
    extra: Partial<SequenceStep> & { pointers?: SequencePointer[] } = {},
  ) => {
    const { pointers, ...rest } = extra;
    steps.push({
      kind,
      cells: snapshot(cells),
      pointers: pointers ?? basePointers(),
      highlightLines,
      description,
      cost,
      ...(circular ? { closesRing: true } : {}),
      ...rest,
    });
  };

  /**
   * Walks `prev` from head to `stop`, one frame per hop. `extra` carries what
   * has to survive the walk: the floating node an insertion is holding, and
   * the call line of the run being watched.
   */
  const walkTo = (
    stop: number,
    lines: number[],
    label: string,
    extra: Partial<SequenceStep> & { lead?: number[] } = {},
  ) => {
    const { lead = [], ...rest } = extra;
    for (let j = 0; j < stop; j += 1) {
      cost += 1;
      cells[j] = { ...cells[j]!, state: 'active' };
      push(
        'walk',
        [...lead, ...lines],
        `${label} avanza al nodo ${cells[j]!.value} (paso ${j + 1}).`,
        {
          ...rest,
          pointers: basePointers([{ name: label, index: j }]),
        },
      );
      cells[j] = { ...cells[j]!, state: 'idle' };
    }
  };

  switch (operation) {
    case 'insert-first': {
      // Four frames per value, one per line of the method, and each one is a
      // state the reader can name: the node exists pointing at null; its link
      // is aimed at the old first node; `head` is aimed at IT, still floating;
      // and only then does it take its place in the chain. Collapsing the last
      // two would show the pointer move and the node move as one jump.
      requireValues(input).forEach((x, run) => {
        startRun();
        const wasFirst = cells.length > 0 ? cells[0]!.value : null;
        const callLine = runLine(run);
        if (circular) {
          // Same four-frame discipline, with the walk the ring forces in the
          // middle: the last node has to be found before it can be told the
          // first one changed.
          const held = { value: x, label: 'fresh', slot: Math.max(maxSlots - cells.length - 1, 0) };
          cost += 1;
          push('build', [...callLine, lineOf(code, 'new Node(x)')], `Creamos el nodo ${x}.`, {
            carry: held,
          });
          if (cells.length === 0) {
            cost += 1;
            push(
              'link',
              [...callLine, lineOf(code, 'fresh.next = fresh')],
              `La cadena estaba vacía: ${x} se apunta a sí mismo y el anillo tiene un solo nodo.`,
              { carry: held },
            );
          } else {
            cost += 1;
            push(
              'start',
              [...callLine, lineOf(code, 'Node last = head')],
              `last parte en head, sobre el nodo ${cells[0]!.value}.`,
              { carry: held, pointers: basePointers([{ name: 'last', index: 0 }]) },
            );
            for (let j = 1; j < cells.length; j += 1) {
              cost += 1;
              cells[j] = { ...cells[j]!, state: 'active' };
              push(
                'walk',
                [
                  ...callLine,
                  lineOf(code, 'while (last.next != head)'),
                  lineOf(code, 'last = last.next'),
                ],
                `last.next todavía no es head: avanzamos al nodo ${cells[j]!.value}.`,
                { carry: held, pointers: basePointers([{ name: 'last', index: j }]) },
              );
              cells[j] = { ...cells[j]!, state: 'idle' };
            }
            cost += 1;
            push(
              'link',
              [...callLine, lineOf(code, 'fresh.next = head')],
              `${x} apunta a ${wasFirst}, que era el primero.`,
              {
                carry: { ...held, next: 0 },
                pointers: basePointers([{ name: 'last', index: cells.length - 1 }]),
              },
            );
            cost += 1;
            push(
              'link',
              [...callLine, lineOf(code, 'last.next = fresh')],
              `El último cierra el anillo sobre ${x} en vez de sobre ${wasFirst}.`,
              {
                carry: { ...held, next: 0 },
                linkToCarry: cells.length - 1,
                pointers: basePointers([{ name: 'last', index: cells.length - 1 }]),
              },
            );
          }
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'head = fresh')],
            `head pasa a apuntar al nodo ${x}.`,
            { carry: { ...held, next: cells.length > 0 ? 0 : null }, headToCarry: true },
          );
          cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
          cost += 1;
          push(
            'done',
            [...callLine, lineOf(code, 'size++')],
            `El nodo ${x} queda primero y el anillo está cerrado. El largo pasa a ${cells.length}.`,
          );
          cells[0] = { ...cells[0]!, state: 'idle' };
          return;
        }
        cost += 1;
        push(
          'build',
          [...callLine, lineOf(code, 'new Node(x)')],
          `Creamos el nodo ${x}. Su next todavía no apunta a nadie.`,
          { carry: { value: x, label: 'fresh', next: null } },
        );
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'fresh.next = head')],
          wasFirst === null
            ? `fresh.next toma el valor de head, que es null: la cadena estaba vacía.`
            : `fresh.next toma el valor de head, así que apunta a ${wasFirst}.`,
          { carry: { value: x, label: 'fresh', next: cells.length > 0 ? 0 : null } },
        );
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'head = fresh')],
          `head pasa a apuntar al nodo ${x}, que ya está enlazado a la cadena.`,
          {
            carry: { value: x, label: 'fresh', next: cells.length > 0 ? 0 : null },
            headToCarry: true,
          },
        );
        cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
        cost += 1;
        push(
          'done',
          [...callLine, lineOf(code, 'size++')],
          `El nodo ${x} queda como primero de la cadena. El largo pasa a ${cells.length}.`,
        );
        cells[0] = { ...cells[0]!, state: 'idle' };
      });
      break;
    }
    case 'insert-last': {
      // The same four-frame discipline as insert-first, with one branch more:
      // an empty chain has no last node to link to, so what the insertion
      // assigns is `head` itself. Starting from zero shows that branch taken
      // once and never again — and the walk getting one hop longer on every
      // insertion, which is the $$\Theta(N)$$ this slide is about.
      requireValues(input).forEach((x, run) => {
        startRun();
        const callLine = runLine(run);
        // Parked above the slot the node will land in, so it lands where it
        // has been hovering rather than jumping across the chain.
        const held = { value: x, label: 'fresh', next: null, slot: cells.length };
        const empty = cells.length === 0;
        cost += 1;
        push(
          'build',
          [...callLine, lineOf(code, 'new Node(x)')],
          `Creamos el nodo ${x}. Es el que quedará último, así que su next es null.`,
          { carry: held },
        );
        cost += 1;
        push(
          'compare',
          [...callLine, lineOf(code, 'if (head == null)')],
          empty
            ? 'head es null: la cadena está vacía, así que el nodo nuevo es también el primero.'
            : // With `tail` there is nothing to walk — saying so here is the
              // whole point of the prop, and the slide that mounts it says
              // "ninguna de las tres recorre la cadena". The un-branched
              // string contradicted both, twice per run (#294 review).
              tail
              ? 'head no es null: hay un último nodo, y tail ya lo tiene localizado.'
              : 'head no es null: hay un último nodo, y hay que caminar hasta él.',
          { carry: held },
        );
        if (empty) {
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'head = fresh')],
            `head pasa a apuntar al nodo ${x}: la cadena deja de estar vacía.`,
            { carry: held, headToCarry: true },
          );
        } else if (tail) {
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'tail.next = fresh')],
            `tail ya apunta al último: enlazamos ${x} sin recorrer nada.`,
            { carry: held, linkToCarry: cells.length - 1 },
          );
        } else {
          // `current` starts at head and stops on the node whose next is null.
          // The last hop leaves it THERE, so the linking frame still shows
          // which node is being modified.
          for (let j = 0; j < cells.length; j += 1) {
            cost += 1;
            cells[j] = { ...cells[j]!, state: 'active' };
            push(
              // `current = head` is not a hop: the walk frames are exactly the
              // hops, so counting them reproduces the $$N - 1$$ the prose claims.
              j === 0 ? 'start' : 'walk',
              j === 0
                ? [...callLine, lineOf(code, 'Node current = head')]
                : [
                    ...callLine,
                    lineOf(
                      code,
                      `while (${circular ? 'current.next != head' : 'current.next != null'}`,
                    ),
                    lineOf(code, 'current = current.next'),
                  ],
              j === 0
                ? `current parte en head, sobre el nodo ${cells[0]!.value}.`
                : `current.next no era null: avanzamos al nodo ${cells[j]!.value} (salto ${j}).`,
              { carry: held, pointers: basePointers([{ name: 'current', index: j }]) },
            );
            if (j < cells.length - 1) cells[j] = { ...cells[j]!, state: 'idle' };
          }
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'current.next = fresh')],
            `current.next deja de ser null y pasa a apuntar al nodo ${x}.`,
            {
              carry: held,
              linkToCarry: cells.length - 1,
              pointers: basePointers([{ name: 'current', index: cells.length - 1 }]),
            },
          );
          cells[cells.length - 1] = { ...cells[cells.length - 1]!, state: 'idle' };
        }
        cells.push({ id: (nextId += 1), value: x, state: 'new' });
        if (tail) {
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'tail = fresh')],
            `tail pasa a apuntar al nodo ${x}, que ya es el último de la cadena.`,
          );
        }
        cost += 1;
        push(
          'done',
          [...callLine, lineOf(code, 'size++')],
          `El nodo ${x} queda al final de la cadena. El largo pasa a ${cells.length}.`,
        );
        cells[cells.length - 1] = { ...cells[cells.length - 1]!, state: 'idle' };
      });
      break;
    }
    case 'insert-at': {
      const values = requireValues(input);
      const indices = asRuns(input.index);
      values.forEach((x, run) => {
        startRun();
        const callLine = runLine(run);
        // Validated against the chain as it is NOW: three insertions in a row
        // move every position after the first one.
        const at = checkIndex(indices[run] ?? indices[0], cells.length, true);
        if (at === 0) {
          // No previous node exists at the front, so the method hands the
          // work to insertFirst. Two frames, drawn in insertFirst's own
          // vocabulary — the node floats, head reaches it, then it lands.
          // Parked over slot 0 — the slot it will occupy. Left at the
          // default the floating node sits mid-chain, and `head` reaching up
          // to it crosses both the first node and the link coming down from
          // the node itself.
          const held = {
            value: x,
            label: 'fresh',
            next: cells.length > 0 ? 0 : null,
            slot: 0,
          };
          cost += 1;
          push(
            'compare',
            [...callLine, lineOf(code, 'if (i == 0)')],
            `La posición es 0: no hay nodo previo que modificar, así que el trabajo es el de insertFirst.`,
            { carry: held },
          );
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'insertFirst(x)')],
            `head pasa a apuntar al nodo ${x}, que ya está enlazado a la cadena.`,
            { carry: held, headToCarry: true },
          );
          cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
          push(
            'done',
            [...callLine, lineOf(code, 'insertFirst(x)')],
            `El nodo ${x} queda en la posición 0. El largo pasa a ${cells.length}.`,
          );
          cells[0] = { ...cells[0]!, state: 'idle' };
          return;
        }
        const held = { value: x, label: 'fresh', slot: at };
        // Inserting AT `size` is legal and means "at the end": there is no
        // node to displace, and what the new node's `next` takes is `null`.
        const displaced = cells[at];
        cost += 1;
        push(
          'build',
          [...callLine, lineOf(code, 'new Node(x)')],
          `Creamos el nodo ${x} para la posición ${at}.`,
          { carry: held },
        );
        walkTo(at - 1, [lineOf(code, 'for (int j'), lineOf(code, 'prev = prev.next')], 'prev', {
          carry: held,
          lead: callLine,
        });
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'fresh.next = prev.next')],
          displaced === undefined
            ? `${x} toma el enlace del previo, que era null: va a quedar último.`
            : `${x} apunta al nodo que ocupaba la posición ${at}.`,
          {
            carry: { ...held, next: displaced === undefined ? null : at },
            pointers: basePointers([{ name: 'prev', index: at - 1 }]),
          },
        );
        // The second assignment, before the node moves — the same frame
        // insertLast gets at the end of the chain. Without it the pointer
        // change and the node taking its place read as one jump.
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'prev.next = fresh')],
          displaced === undefined
            ? `El último nodo deja de apuntar a null y pasa a apuntar a ${x}.`
            : `El nodo anterior deja de apuntar a ${displaced.value} y pasa a apuntar a ${x}.`,
          {
            carry: { ...held, next: displaced === undefined ? null : at },
            linkToCarry: at - 1,
            pointers: basePointers([{ name: 'prev', index: at - 1 }]),
          },
        );
        cells.splice(at, 0, { id: (nextId += 1), value: x, state: 'new' });
        cost += 1;
        push(
          'done',
          [...callLine, lineOf(code, 'size++')],
          `El nodo ${x} queda en la posición ${at}. El largo pasa a ${cells.length}.`,
        );
        cells[at] = { ...cells[at]!, state: 'idle' };
      });
      break;
    }
    case 'insert-ordered': {
      const sorted = input.values.every((v, i) => i === 0 || input.values[i - 1]! <= v);
      if (!sorted) {
        throw new Error('La lista de partida debe venir ordenada para insertar en orden.');
      }
      asRuns(input.target).forEach((x, run) => {
        startRun();
        const callLine = runLine(run);
        const first = cells.length === 0 ? null : cells[0]!.value;
        cost += 1;
        push(
          'compare',
          [...callLine, lineOf(code, 'if (head == null || x <= head.value)')],
          first === null
            ? `La cadena está vacía: ${x} es el primero.`
            : first >= x
              ? `¿${x} es menor o igual que ${first}, el primero? Sí: va al frente, y de eso ya sabe insertFirst.`
              : `¿${x} es menor o igual que ${first}, el primero? No: hay que buscarle lugar más adelante.`,
        );
        if (first === null || first >= x) {
          const held = {
            value: x,
            label: 'fresh',
            next: cells.length > 0 ? 0 : null,
            slot: 0,
          };
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'insertFirst(x)')],
            `head pasa a apuntar a ${x}.`,
            {
              carry: held,
              headToCarry: true,
            },
          );
          cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
          push(
            'done',
            [...callLine, lineOf(code, 'insertFirst(x)')],
            `El nodo ${x} queda primero y el orden se mantiene. El largo pasa a ${cells.length}.`,
          );
          cells[0] = { ...cells[0]!, state: 'idle' };
          return;
        }
        cost += 1;
        // `prev` walks the node BEFORE the gap, exactly as the listing does:
        // the comparison is always against `prev.next`, never against `prev`.
        let prev = 0;
        const held = { value: x, label: 'fresh', slot: 1 };
        push(
          'build',
          [...callLine, lineOf(code, 'new Node(x)')],
          `Creamos el nodo ${x} y buscamos entre qué dos nodos va.`,
          { carry: held },
        );
        push(
          'start',
          [...callLine, lineOf(code, 'Node prev = head')],
          `prev parte en head, sobre el nodo ${cells[0]!.value}.`,
          { carry: held, pointers: basePointers([{ name: 'prev', index: 0 }]) },
        );
        for (;;) {
          const nextCell = cells[prev + 1];
          const goes = nextCell !== undefined && nextCell.value < x;
          cost += 1;
          push(
            'compare',
            goes
              ? [...callLine, lineOf(code, 'while (prev.next'), lineOf(code, 'prev = prev.next')]
              : [...callLine, lineOf(code, 'while (prev.next')],
            nextCell === undefined
              ? `prev.next es null: ${x} es mayor que todos y va al final.`
              : goes
                ? `¿${nextCell.value} < ${x}? Sí: ${x} va más adelante.`
                : `¿${nextCell.value} < ${x}? No: el lugar de ${x} es entre ${cells[prev]!.value} y ${nextCell.value}.`,
            {
              carry: { ...held, slot: prev + 1 },
              pointers: basePointers([{ name: 'prev', index: prev }]),
            },
          );
          if (!goes) break;
          prev += 1;
        }
        const at = prev + 1;
        const displaced = cells[at];
        const parked = { ...held, slot: at };
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'fresh.next = prev.next')],
          displaced === undefined
            ? `${x} toma el enlace del previo, que era null: va a quedar último.`
            : `${x} apunta a ${displaced.value}, el nodo que seguía.`,
          {
            carry: { ...parked, next: displaced === undefined ? null : at },
            pointers: basePointers([{ name: 'prev', index: prev }]),
          },
        );
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'prev.next = fresh')],
          `${cells[prev]!.value} deja de apuntar a ${displaced === undefined ? 'null' : displaced.value} y pasa a apuntar a ${x}.`,
          {
            carry: { ...parked, next: displaced === undefined ? null : at },
            linkToCarry: prev,
            pointers: basePointers([{ name: 'prev', index: prev }]),
          },
        );
        cells.splice(at, 0, { id: (nextId += 1), value: x, state: 'new' });
        cost += 1;
        push(
          'done',
          [...callLine, lineOf(code, 'size++')],
          `${x} queda en la posición ${at} y el orden se mantiene. El largo pasa a ${cells.length}.`,
        );
        cells[at] = { ...cells[at]!, state: 'idle' };
      });
      break;
    }
    case 'remove-first': {
      requireNonEmpty(input.values);
      requireRoom(args.length, cells.length, 'deleteFirst');
      args.forEach((_, run) => {
        startRun();
        const callLine = runLine(run);
        const removed = cells[0]!;
        cells[0] = { ...removed, state: 'leaving' };
        cost += 1;
        push(
          'start',
          [...callLine, lineOf(code, 'Node old = head')],
          `Guardamos el primer nodo (${removed.value}).`,
        );
        cells.shift();
        cost += 1;
        push(
          'unlink',
          [...callLine, lineOf(code, 'head = head.next')],
          `head pasa a apuntar al segundo nodo${cells.length > 0 ? ` (${cells[0]!.value})` : ' (null: la lista queda vacía)'}.`,
        );
        push(
          'done',
          [...callLine, lineOf(code, 'return old.value')],
          `El largo pasa a ${cells.length}. Devolvemos ${removed.value}.`,
        );
      });
      break;
    }
    case 'remove-last': {
      requireNonEmpty(input.values);
      requireRoom(args.length, cells.length, 'deleteLast');
      args.forEach((_, run) => {
        startRun();
        const callLine = runLine(run);
        const removed = cells[cells.length - 1]!;
        const alone = cells.length === 1;
        // Checked first: with one node `tail.prev` is null, so the tail
        // shortcut below would light `tail.next = null` over a null.
        if (doubly && tail && !alone) {
          // The only O(1) delete-last in the family: `prev` is already there.
          cost += 1;
          push(
            'start',
            [...callLine, lineOf(code, 'Node old = tail')],
            `tail apunta al último nodo (${removed.value}).`,
          );
          cost += 1;
          push(
            'unlink',
            [...callLine, lineOf(code, 'tail = tail.prev')],
            `tail retrocede por prev — sin recorrer la cadena.`,
          );
        } else if (alone) {
          cost += 1;
          push(
            'compare',
            [
              ...callLine,
              lineOf(code, doubly && tail ? 'if (head == tail)' : 'if (head.next == null)'),
            ],
            `Queda un solo nodo: no hay anteúltimo a quien pedirle que apunte a null.`,
          );
        } else {
          // Every other recipe needs the node BEFORE the last one, and only a
          // walk can produce it: `tail` alone is not enough.
          walkTo(
            cells.length - 2,
            [lineOf(code, 'while (prev.next.next'), lineOf(code, 'prev = prev.next')],
            'prev',
            { lead: callLine },
          );
          cost += 1;
          push(
            'start',
            [...callLine, lineOf(code, 'old = prev.next')],
            `El nodo anterior al último es quien debe soltarlo.`,
            {
              pointers: basePointers([{ name: 'prev', index: cells.length - 2 }]),
            },
          );
        }
        cells.pop();
        cost += 1;
        push(
          'unlink',
          [
            ...callLine,
            lineOf(
              code,
              alone ? 'head = null' : doubly && tail ? 'tail.next = null' : 'prev.next = null',
            ),
          ],
          alone
            ? `head pasa a null: la cadena queda vacía. El largo pasa a 0.`
            : `El nuevo último apunta a ${circular ? 'head' : 'null'}. El largo pasa a ${cells.length}.`,
        );
        push(
          'done',
          [...callLine, lineOf(code, 'return old.value')],
          `Devolvemos ${removed.value}.`,
        );
      });
      break;
    }
    case 'remove-at': {
      requireNonEmpty(input.values);
      const removals = asRuns(input.index);
      requireRoom(removals.length, cells.length, 'deleteAt');
      removals.forEach((raw, run) => {
        startRun();
        const callLine = runLine(run);
        const at = checkIndex(raw, cells.length, false);
        if (at === 0) {
          // No previous node at the front, so the method hands the work to
          // deleteFirst — which is what the reader should conclude too.
          const removed = cells[0]!;
          cells[0] = { ...removed, state: 'leaving' };
          cost += 1;
          push(
            'compare',
            [...callLine, lineOf(code, 'if (i == 0)')],
            `La posición es 0: no hay nodo previo, así que el trabajo es el de deleteFirst.`,
          );
          cells.shift();
          cost += 1;
          push(
            'unlink',
            [...callLine, lineOf(code, 'return deleteFirst()')],
            `head pasa a apuntar al segundo nodo. El largo pasa a ${cells.length}. Devolvemos ${removed.value}.`,
          );
          return;
        }
        walkTo(at - 1, [lineOf(code, 'for (int j'), lineOf(code, 'prev = prev.next')], 'prev', {
          lead: callLine,
        });
        const removed = cells[at]!;
        cells[at] = { ...removed, state: 'leaving' };
        cost += 1;
        push(
          'start',
          [...callLine, lineOf(code, 'Node old = prev.next')],
          `El nodo a eliminar es ${removed.value}, en la posición ${at}.`,
          { pointers: basePointers([{ name: 'prev', index: at - 1 }]) },
        );
        cells.splice(at, 1);
        cost += 1;
        push(
          'unlink',
          [...callLine, lineOf(code, 'prev.next = old.next')],
          `El nodo anterior salta por encima y apunta al siguiente. El largo pasa a ${cells.length}.`,
        );
        push(
          'done',
          [...callLine, lineOf(code, 'return old.value')],
          `Devolvemos ${removed.value}.`,
        );
      });
      break;
    }
    case 'get-at': {
      requireNonEmpty(input.values);
      asRuns(input.index).forEach((raw, run) => {
        startRun();
        const callLine = runLine(run);
        const at = checkIndex(raw, cells.length, false);
        push(
          'start',
          [...callLine, lineOf(code, 'Node current = head')],
          `current parte de head, en la posición 0.`,
          { pointers: basePointers([{ name: 'current', index: 0 }]) },
        );
        // One frame per hop: the whole point of the operation is that there
        // are `i` of them, so skipping any would hide the cost it teaches.
        for (let j = 0; j < at; j += 1) {
          cost += 1;
          cells[j + 1] = { ...cells[j + 1]!, state: 'active' };
          push(
            'walk',
            [...callLine, lineOf(code, 'for (int j'), lineOf(code, 'current = current.next')],
            `Salto ${j + 1}: current avanza al nodo ${cells[j + 1]!.value}, en la posición ${j + 1}.`,
            { pointers: basePointers([{ name: 'current', index: j + 1 }]) },
          );
          cells[j + 1] = { ...cells[j + 1]!, state: 'idle' };
        }
        cells[at] = { ...cells[at]!, state: 'found' };
        push(
          'found',
          [...callLine, lineOf(code, 'return current.value')],
          `Llegamos a la posición ${at} tras ${at} salto${at === 1 ? '' : 's'}. Devolvemos ${cells[at]!.value}.`,
          { pointers: basePointers([{ name: 'current', index: at }]) },
        );
        // The hit is cleared before the next run starts looking.
        cells[at] = { ...cells[at]!, state: 'idle' };
      });
      break;
    }
    case 'search': {
      requireNonEmpty(input.values);
      asRuns(input.target).forEach((target, run) => {
        startRun();
        const callLine = runLine(run);
        push(
          'start',
          [...callLine, lineOf(code, 'Node current = head')],
          `Buscamos ${target} desde head: la lista no tiene aritmética de posiciones.`,
        );
        let found = -1;
        for (let j = 0; j < cells.length; j += 1) {
          cost += 1;
          const hit = cells[j]!.value === target;
          cells[j] = { ...cells[j]!, state: hit ? 'found' : 'active' };
          push(
            hit ? 'found' : 'compare',
            hit
              ? [...callLine, lineOf(code, 'if (current.value == x')]
              : [...callLine, lineOf(code, 'current = current.next')],
            `¿El nodo ${cells[j]!.value} es ${target}? ${hit ? 'Sí.' : 'No: avanzamos.'}`,
            { pointers: basePointers([{ name: 'current', index: j }]) },
          );
          if (hit) {
            found = j;
            break;
          }
          cells[j] = { ...cells[j]!, state: 'idle' };
        }
        push(
          found >= 0 ? 'found' : 'done',
          found >= 0
            ? [...callLine, lineOf(code, 'return i;')]
            : [...callLine, lineOf(code, 'return -1;')],
          found >= 0
            ? `Encontramos ${target} tras recorrer ${found + 1} nodo${found === 0 ? '' : 's'}.`
            : `Recorrimos los ${cells.length} nodos: ${target} no está en la lista.`,
        );
        if (found >= 0) cells[found] = { ...cells[found]!, state: 'idle' };
      });
      break;
    }
  }

  const last = steps.at(-1)!;
  steps[steps.length - 1] = { ...last, cells: settle(last.cells) };
  return {
    steps,
    code,
    maxCells: Math.max(...steps.map((f) => f.cells.length)),
    // insert-first and remove-first change the FRONT of the chain, so the
    // cells are drawn flush right and the reserved slot sits where the new
    // node is about to land.
    align: operation === 'insert-first' || operation === 'remove-first' ? 'right' : 'left',
    hasCarry: steps.some((f) => f.carry !== undefined),
  };
}

// ── the heap ──────────────────────────────────────────────────────────────
//
// A binary max-heap in Sedgewick's shape (#304, ADR-0077): 1-based, so the
// parent of `k` is `k / 2` and its children `2k` and `2k + 1` with no `±1`
// anywhere, and `data[0]` never used. The frame model is the widget's, with
// one fork from the dynamic array: no `slots`; `cells` is `data[1..]` in
// order (the stale copies past `n` included), `capacity` is `data.length`
// (slot 0 included), and `heapSize` is `n`, where the live cells end. The painter draws the same cells twice —
// as the array and as the complete binary tree the array encodes.
//
// `swim` and `sink` are printed under the operation that calls them, so the
// reader never meets a call to either without its body. The helpers the
// listings call without printing them are prepared before the operations:
// `parent`, `left`, `right` and `swap` are written on the class's own slides,
// and `resize` and `shrinkIfSparse` are named there as the dynamic array's.

// Written on parent / left / right, the index functions the class defines
// just before the operations, so the listing reads as the formulas it derived.
const HEAP_SWIM = `void swim(int k) {
    while (k > 1 && data[parent(k)] < data[k]) {
        swap(parent(k), k);
        k = parent(k);
    }
}`;

const HEAP_SINK = `void sink(int k) {
    while (left(k) <= n) {
        int j = left(k);
        if (right(k) <= n && data[right(k)] > data[j]) {
            j = right(k);
        }
        if (data[k] >= data[j]) break;
        swap(k, j);
        k = j;
    }
}`;

const HEAP_CODE: Record<HeapOperation, string> = {
  // Grows exactly as the dynamic array of #277 and #294 does — the same guard
  // and the same `resize(2 * data.length)` — with the one difference 1-based
  // storage makes: the block is full at `n == data.length - 1`, because slot
  // 0 is reserved and holds nothing.
  insert: `void insert(int x) {
    if (n == data.length - 1) {
        resize(2 * data.length);
    }
    data[++n] = x;
    swim(n);
}

${HEAP_SWIM}`,
  'extract-max': `int extractMax() {
    if (n == 0) {
        throw new NoSuchElementException();
    }
    int max = data[1];
    swap(1, n);
    n--;
    sink(1);
    shrinkIfSparse();
    return max;
}

${HEAP_SINK}`,
};

/** How many elements the heap has, as a Spanish sentence. */
const heapCount = (n: number): string =>
  n === 0
    ? 'El heap quedó vacío.'
    : n === 1
      ? 'El heap tiene 1 elemento.'
      : `El heap tiene ${n} elementos.`;

/** Whether `values` read as `data[1..]` already satisfy the max-heap order. */
function isMaxHeap(values: number[]): boolean {
  return values.every((v, i) => i === 0 || values[Math.floor((i + 1) / 2) - 1]! >= v);
}

function traceHeap(operation: SequenceOperation, input: SequenceInput): SequenceTrace {
  const op = operation as HeapOperation;
  const args = runArgs(operation, input);
  if (args.length === 0) {
    throw new Error('La operación no se ejecuta ninguna vez: falta el argumento que la corre.');
  }
  requireRuns(args.length);
  // insert and extract-max are operations ON a heap: a starting array that
  // is not one would animate the invariant being broken before the
  // operation even runs.
  if (!isMaxHeap(input.values)) {
    throw new Error(
      `[${input.values.join(', ')}] no es un max-heap: algún padre es menor que un hijo.`,
    );
  }
  if (op === 'extract-max') {
    requireNonEmpty(input.values);
    if (args.length > input.values.length) {
      throw new Error(
        `El heap tiene ${input.values.length} elemento${input.values.length === 1 ? '' : 's'} y extractMax se ejecuta ${args.length} veces: la última correría sobre un heap vacío.`,
      );
    }
  }

  const shown = shownName(operation, input);
  const base = renameIn(HEAP_CODE[op], operation, shown);
  const many = args.length > 1;
  const fresh = input.values.length === 0;
  const code = many
    ? base +
      callingProgram(args, shown, fresh, {
        name: input.receiver ?? 'heap',
        type: input.receiverType ?? 'MaxHeap',
      })
    : base;
  const runLine = (run: number): number[] =>
    many ? [base.split('\n').length + (fresh ? 1 : 0) + run + 1] : [];

  // Default block: `data.length = n + 1`, FULL — the dynamic-array recipe's
  // default, so a single insertion shows the growth unless the author passes
  // a larger `capacity`. An EMPTY heap starts at `new int[2]`: one usable slot
  // plus `data[0]`, the dynamic array's one-cell start (#304).
  let capacity = input.capacity ?? Math.max(input.values.length + 1, 2);
  if (!Number.isInteger(capacity)) {
    throw new Error(`La capacidad ${capacity} no es un entero.`);
  }
  if (capacity < input.values.length + 1) {
    throw new Error(
      `capacity es data.length y el slot 0 no se usa: para ${input.values.length} valores hace falta al menos ${input.values.length + 1}.`,
    );
  }
  if (capacity > MAX_CAPACITY) {
    throw new Error(`Un bloque de ${capacity} no se lee proyectado; el máximo es ${MAX_CAPACITY}.`);
  }

  const cells = cellsFrom(input.values);
  let n = cells.length;
  let cost = 0;
  let run = 0;
  const steps: SequenceStep[] = [];

  const push = (
    kind: SequenceStepKind,
    lines: number[],
    description: string,
    pointers: SequencePointer[] = [],
  ) => {
    steps.push({
      kind,
      cells: snapshot(cells),
      pointers,
      highlightLines: [...lines, ...runLine(run)],
      description,
      capacity,
      heapSize: n,
      cost,
    });
  };
  const line = (fragment: string) => lineOf(code, fragment);
  // `k` and `j` are 1-based slots; a pointer indexes `cells`, which is 0-based.
  const at = (name: string, k: number): SequencePointer => ({ name, index: k - 1 });
  const val = (k: number) => cells[k - 1]!.value;
  const paint = (k: number, state: SequenceCellState) => {
    cells[k - 1] = { ...cells[k - 1]!, state };
  };
  const calm = () => {
    for (let k = 1; k <= n; k += 1) {
      const c = cells[k - 1]!;
      if (c.state === 'active' || c.state === 'swap') paint(k, 'idle');
    }
  };
  const exchange = (a: number, b: number) => {
    const ca = cells[a - 1]!;
    cells[a - 1] = { ...cells[b - 1]!, state: 'swap' };
    cells[b - 1] = { ...ca, state: 'swap' };
  };

  const swim = (from: number) => {
    let k = from;
    for (;;) {
      calm();
      cost += 1;
      if (k === 1) {
        push(
          'compare',
          [line('while (k > 1')],
          `k = 1: ${val(1)} llegó a la raíz y no tiene padre con quien comparar. swim termina.`,
          [at('k', 1)],
        );
        return;
      }
      const p = Math.floor(k / 2);
      paint(p, 'active');
      paint(k, 'active');
      const up = val(p) < val(k);
      push(
        'compare',
        [line('while (k > 1')],
        up
          ? `¿data[${p}] = ${val(p)} es menor que data[${k}] = ${val(k)}? Sí: el padre es menor, y en esta arista se rompe la invariante de orden de heap.`
          : `¿data[${p}] = ${val(p)} es menor que data[${k}] = ${val(k)}? No: el padre es mayor o igual, y la invariante de orden de heap se cumple. swim termina.`,
        [at('k', k)],
      );
      if (!up) return;
      cost += 1;
      exchange(p, k);
      push(
        'shift',
        [line('swap(parent(k), k);'), line('k = parent(k);')],
        `Intercambiamos data[${p}] y data[${k}]: ${val(p)} sube a la posición ${p}, lo que restaura la invariante de orden de heap en esta arista. k pasa a ${p}.`,
        [at('k', p)],
      );
      k = p;
    }
  };

  const sink = (from: number) => {
    let k = from;
    for (;;) {
      calm();
      cost += 1;
      if (2 * k > n) {
        push(
          'compare',
          [line('while (left(k) <= n)')],
          `left(${k}) = ${2 * k} > n = ${n}: la posición ${k} no tiene hijos. sink termina.`,
          [at('k', k)],
        );
        return;
      }
      let j = 2 * k;
      const right = j < n;
      if (right && val(j) < val(j + 1)) j += 1;
      cost += 1;
      paint(j, 'active');
      push(
        'compare',
        [
          line('int j = left(k);'),
          ...(right ? [line('if (right(k) <= n && data[right(k)] > data[j]) {')] : []),
          ...(j === 2 * k + 1 ? [line('j = right(k);')] : []),
        ],
        right
          ? `Los hijos de ${k} son data[${2 * k}] = ${val(2 * k)} y data[${2 * k + 1}] = ${val(2 * k + 1)}: j apunta al mayor, ${val(j)}.`
          : `La posición ${k} tiene un solo hijo, data[${j}] = ${val(j)}: j apunta a él.`,
        [at('k', k), at('j', j)],
      );
      paint(k, 'active');
      cost += 1;
      const stays = val(k) >= val(j);
      push(
        'compare',
        [line('if (data[k] >= data[j]) break;')],
        stays
          ? `¿data[${k}] = ${val(k)} es mayor o igual que ${val(j)}? Sí: la invariante de orden de heap se cumple aquí. sink termina.`
          : `¿data[${k}] = ${val(k)} es mayor o igual que ${val(j)}? No: aquí se rompe la invariante de orden de heap, y el hijo mayor debe subir.`,
        [at('k', k), at('j', j)],
      );
      if (stays) return;
      cost += 1;
      exchange(k, j);
      push(
        'shift',
        [line('swap(k, j);'), line('k = j;')],
        `Intercambiamos data[${k}] y data[${j}]: ${val(k)} sube y ${val(j)} baja a la posición ${j}, lo que restaura la invariante de orden de heap en esta arista. k pasa a ${j}.`,
        [at('k', j)],
      );
      k = j;
    }
  };

  switch (op) {
    case 'insert': {
      let inserted = 0;
      requireValues(input).forEach((x, r) => {
        run = r;
        cost = 0;
        calm();
        // The heap as the call finds it: without this frame the first thing
        // on screen is the value already written, and the reader never sees
        // what the insertion is about to change.
        push(
          'start',
          [line(`void ${shown}(int x)`)],
          n === 0
            ? `insert(${x}): el heap está vacío, n = 0.`
            : `insert(${x}): el heap tiene n = ${n} elemento${n === 1 ? '' : 's'} y su máximo es ${val(1)}.`,
        );
        if (n === capacity - 1) {
          const copied = n;
          capacity *= 2;
          cost += copied;
          push(
            'grow',
            [line('n == data.length - 1'), line('resize(2 * data.length);')],
            `El bloque está lleno (n = ${n} = data.length − 1): se reserva uno de ${capacity} y se ${copied === 1 ? 'copia el único elemento' : `copian los ${copied} elementos`}.`,
          );
        }
        n += 1;
        cost += 1;
        inserted = nextId += 1;
        cells.push({ id: inserted, value: x, state: 'new' });
        push(
          'build',
          [line('data[++n] = x;')],
          `n pasa a ${n} y ${x} ocupa data[${n}]: la primera hoja libre, así se mantiene la invariante de forma completa.`,
          [at('k', n)],
        );
        push('start', [line('swim(n);')], `swim(${n}): ${x} sube mientras su padre sea menor.`, [
          at('k', n),
        ]);
        swim(n);
        calm();
        push('done', [line('swim(n);')], `${x} quedó en su lugar. ${heapCount(n)}`);
        cells.forEach((c, i) => {
          if (c.state === 'new') cells[i] = { ...c, state: 'idle' };
        });
      });
      // The last value inserted keeps its mark on the frame that stays on
      // screen, as every other insertion of the widget does. Found by id: a
      // value can repeat, and the copy already in the heap is not the new one.
      const last = steps.at(-1)!;
      steps[steps.length - 1] = {
        ...last,
        cells: last.cells.map((c) => (c.id === inserted ? { ...c, state: 'new' } : c)),
      };
      break;
    }
    case 'extract-max': {
      args.forEach((_, r) => {
        run = r;
        cost = 0;
        calm();
        const max = val(1);
        cost += 1;
        paint(1, 'leaving');
        push(
          'start',
          [line('int max = data[1];')],
          `El máximo siempre está en la raíz: max = ${max}.`,
          [at('k', 1)],
        );
        cost += 1;
        exchange(1, n);
        push(
          'shift',
          [line('swap(1, n);')],
          n === 1
            ? 'n = 1: la raíz es también el último, así que swap(1, 1) no mueve nada.'
            : `Intercambiamos la raíz con el último, data[${n}]: ${max} pasa al final y ${val(1)} queda en la raíz.`,
          [at('k', 1)],
        );
        n -= 1;
        // The exchange is over: the new root is no longer being moved.
        calm();
        cells[n] = { ...cells[n]!, state: 'stale' };
        push(
          'unlink',
          [line('n--;')],
          `n pasa a ${n}: data[${n + 1}] sigue guardando ${max}, pero ya no es parte del heap. El árbol pierde su última hoja y mantiene la invariante de forma completa.`,
        );
        if (n > 0) {
          push(
            'start',
            [line('sink(1);')],
            `sink(1): ${val(1)} baja mientras algún hijo sea mayor.`,
            [at('k', 1)],
          );
          sink(1);
        }
        calm();
        // The dynamic array's quarter rule, on n: halve the block when n
        // has fallen to a quarter of it. The copy takes data[1..n] only, so
        // what was past n — the stale maxima — does not survive it.
        // Integer division, as in the Java: a block of 5 has a quarter of 1
        // and halves to 2, never to 2.5.
        if (n > 0 && n === Math.floor(capacity / 4)) {
          const before = capacity;
          capacity = Math.floor(capacity / 2);
          cells.length = n;
          cost += n;
          const quarter =
            before % 4 === 0
              ? `n = ${n} es un cuarto de data.length = ${before}`
              : `n = ${n} es data.length / 4 = ${before} / 4 en división entera`;
          push(
            'shrink',
            [line('shrinkIfSparse();')],
            `${quarter}: shrinkIfSparse achica el bloque a ${capacity} y ${n === 1 ? 'copia el único elemento del heap' : `copia los ${n} elementos del heap`}.`,
          );
        } else {
          push(
            'compare',
            [line('shrinkIfSparse();')],
            n === 0
              ? 'n = 0, y shrinkIfSparse sólo achica cuando quedan elementos: el bloque no cambia.'
              : `n = ${n} no es un cuarto de data.length = ${capacity}: shrinkIfSparse no achica el bloque.`,
          );
        }
        push('done', [line('return max;')], `extractMax devuelve ${max}. ${heapCount(n)}`);
      });
      break;
    }
  }

  return {
    steps,
    code,
    maxCells: Math.max(...steps.map((f) => f.cells.length)),
    align: 'left',
    hasCarry: false,
  };
}
