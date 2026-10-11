/**
 * Geometry for the tree recipes of `<SequenceStepper>` (#321), as a pure
 * module — the shape `sequenceStepperHeapLayout` follows (`apps/web/CLAUDE.md`
 * §2): every coordinate the tree view paints comes from here, so the suite
 * checks it exactly and the browser is left to confirm only that it looks
 * right.
 *
 * A node sits in the COLUMN of its inorder position and on the ROW of its
 * depth. Two things follow from that alone. A parent always sits between its
 * two subtrees, so no edge crosses another. And a strip drawn under the tree
 * with one slot per column puts every value under its own node: the inorder
 * of any tree reads straight down, and the inorder of a search tree reads
 * sorted — which is the theorem the class states, made visible.
 */

/** Radius of a node. */
export const TREE_NODE_R = 17;
/** Horizontal room per column. */
const COLUMN_W = 46;
/** Vertical distance between two levels. */
const LEVEL_H = 56;
/** Margin around the drawing, room for a badge beside a node. */
const PAD = 16;
/** Room under the deepest node for its note, before the strip. */
const NOTE_H = 16;
/** Width and height of a strip slot. */
const SLOT_W = 38;
const SLOT_H = 30;
/** Gap between the deepest note and the strip. */
const STRIP_GAP = 12;

export interface TreePoint {
  cx: number;
  cy: number;
}

export interface TreeStripSlot {
  /** Centre of the slot, the same x as the column above it. */
  cx: number;
  /** Top of the slot. */
  y: number;
  w: number;
  h: number;
}

export interface TreeLayout {
  width: number;
  height: number;
  /** Where a node of this column and this depth sits. */
  node: (column: number, depth: number) => TreePoint;
  /** One slot per column, under it. */
  strip: TreeStripSlot[];
}

/**
 * `slots` is how many columns the run ever needs — every node it ever holds —
 * and `depth` the deepest level any frame reaches. Both come from the whole
 * run, so the canvas keeps one size from the first frame to the last.
 */
export function layoutTree(slots: number, depth: number): TreeLayout {
  const columnX = (column: number) => PAD + (column + 0.5) * COLUMN_W;
  const rowY = (level: number) => PAD + TREE_NODE_R + level * LEVEL_H;
  const stripY = rowY(depth) + TREE_NODE_R + NOTE_H + STRIP_GAP;
  return {
    width: 2 * PAD + slots * COLUMN_W,
    height: stripY + SLOT_H + PAD,
    node: (column, level) => ({ cx: columnX(column), cy: rowY(level) }),
    strip: Array.from({ length: slots }, (_, column) => ({
      cx: columnX(column),
      y: stripY,
      w: SLOT_W,
      h: SLOT_H,
    })),
  };
}

/** The edge from a parent down to a child, trimmed to the two rims. */
export function treeEdge(
  parent: TreePoint,
  child: TreePoint,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = child.cx - parent.cx;
  const dy = child.cy - parent.cy;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: parent.cx + ux * TREE_NODE_R,
    y1: parent.cy + uy * TREE_NODE_R,
    x2: child.cx - ux * TREE_NODE_R,
    y2: child.cy - uy * TREE_NODE_R,
  };
}
