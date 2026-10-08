/**
 * Geometry for the `heap-max` recipe of `<SequenceStepper>` (#304,
 * ADR-0077), as a pure module — the same recipe `sequenceStepperLayout`
 * follows (`apps/web/CLAUDE.md` §2): every coordinate the heap view paints
 * comes from here, so the suite checks it exactly and the browser is left to
 * confirm only that it looks right.
 *
 * Two pictures of ONE array. The tree is the complete binary tree the array
 * encodes — node `k` sits on level `floor(log2 k)`, its children are `2k` and
 * `2k + 1` — and the array is `data[0..]`, slot 0 included, because the
 * reason it is empty is part of the lesson. Each is its own canvas, so the
 * painter can stack them in the book and set them side by side on a slide.
 */

/** Radius of a tree node. */
export const HEAP_NODE_R = 17;
/** Side of an array cell. */
export const HEAP_BOX = 40;
/** Horizontal room per slot of the tree's bottom level. */
const LEAF_PITCH = 46;
/** Vertical distance between two levels of the tree. */
const LEVEL_H = 54;
/** Margin around the tree, room for the index written beside a node. */
const TREE_PAD = 14;
/** Room above the array cells, clear of the size readout. */
const ARRAY_TOP = 8;
/** Room between the cells and the index rail, and between the rows below. */
const ROW_GAP = 16;
/** Horizontal margin around the array. */
const ARRAY_PAD = 4;

export interface HeapTreeNode {
  /** The 1-based array index this node stands for. */
  k: number;
  cx: number;
  cy: number;
}

export interface HeapArrayBox {
  /** The array index, 0 first. */
  slot: number;
  x: number;
  y: number;
}

export interface HeapLayout {
  tree: { width: number; height: number; nodes: HeapTreeNode[] };
  array: {
    width: number;
    height: number;
    boxes: HeapArrayBox[];
    /** Baseline of the index rail under the cells. */
    railY: number;
    /** Baseline of the `k` / `j` cursor labels, and of slot 0's note. */
    pointerY: number;
  };
}

const levelsFor = (count: number) => (count <= 0 ? 1 : Math.floor(Math.log2(count)) + 1);

/**
 * `maxCells` is the most elements any frame of the run holds, so the tree
 * keeps one size from the first frame to the last. `slots` is the block THIS
 * frame has (`data.length`, slot 0 included) and `reserve` the widest block
 * the run reaches, so a block that doubles extends into room already there —
 * the dynamic-array recipe's rule.
 */
export function layoutHeap(maxCells: number, slots: number, reserve: number = slots): HeapLayout {
  const levels = levelsFor(maxCells);
  const leaves = 2 ** (levels - 1);
  const nodes: HeapTreeNode[] = [];
  for (let k = 1; k <= maxCells; k += 1) {
    const level = Math.floor(Math.log2(k));
    const across = k - 2 ** level;
    const span = leaves / 2 ** level;
    nodes.push({
      k,
      cx: TREE_PAD + (across + 0.5) * span * LEAF_PITCH,
      cy: TREE_PAD + HEAP_NODE_R + level * LEVEL_H,
    });
  }
  const tree = {
    width: 2 * TREE_PAD + leaves * LEAF_PITCH,
    height: 2 * TREE_PAD + 2 * HEAP_NODE_R + (levels - 1) * LEVEL_H,
    nodes,
  };

  const boxes: HeapArrayBox[] = Array.from({ length: slots }, (_, slot) => ({
    slot,
    x: ARRAY_PAD + slot * HEAP_BOX,
    y: ARRAY_TOP,
  }));
  const railY = ARRAY_TOP + HEAP_BOX + ROW_GAP;
  const pointerY = railY + ROW_GAP + 4;
  return {
    tree,
    array: {
      width: 2 * ARRAY_PAD + Math.max(slots, reserve) * HEAP_BOX,
      height: pointerY + ROW_GAP,
      boxes,
      railY,
      pointerY,
    },
  };
}

/**
 * The edge from node `k`'s parent down to node `k`, trimmed to the two rims
 * so it never runs through a value.
 */
export function heapEdge(
  layout: HeapLayout,
  k: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const parent = layout.tree.nodes[Math.floor(k / 2) - 1]!;
  const child = layout.tree.nodes[k - 1]!;
  const dx = child.cx - parent.cx;
  const dy = child.cy - parent.cy;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: parent.cx + ux * HEAP_NODE_R,
    y1: parent.cy + uy * HEAP_NODE_R,
    x2: child.cx - ux * HEAP_NODE_R,
    y2: child.cy - uy * HEAP_NODE_R,
  };
}
