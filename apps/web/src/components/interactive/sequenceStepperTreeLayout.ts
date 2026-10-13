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
 *
 * COPIED: the file-local `BinaryPicture` of `21-edd-arboles-i.mdx` draws its
 * static trees with these same numbers (node radius, column width, level
 * height, margin, strip slot), so a figure and the widget beside it match. A
 * second copy lives in `22-edd-arboles-ii.mdx`, which #322 — stacked on #321
 * — brings and promotes to a shared component, retiring both copies. Those copies are the ones that fail late —
 * nothing tests a document's own components — so a change here is carried
 * there by hand and checked in a browser.
 */

import { rimToRim } from './sequenceStepperEdge';

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
 * `withStrip` is false for an operation that writes nothing out, which then
 * gets no strip and no room reserved for one.
 */
export function layoutTree(slots: number, depth: number, withStrip = true): TreeLayout {
  const columnX = (column: number) => PAD + (column + 0.5) * COLUMN_W;
  const rowY = (level: number) => PAD + TREE_NODE_R + level * LEVEL_H;
  const below = rowY(depth) + TREE_NODE_R + NOTE_H;
  const stripY = below + STRIP_GAP;
  return {
    width: 2 * PAD + slots * COLUMN_W,
    height: withStrip ? stripY + SLOT_H + PAD : below + PAD,
    node: (column, level) => ({ cx: columnX(column), cy: rowY(level) }),
    strip: Array.from({ length: withStrip ? slots : 0 }, (_, column) => ({
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
  return rimToRim(parent, child, TREE_NODE_R);
}

/** The empty subtree a call landed on: a small dashed box under its parent, `null` in it. */
export interface TreeProbe {
  /** From the parent's rim to the top of the box. */
  line: { x1: number; y1: number; x2: number; y2: number };
  box: { x: number; y: number; w: number; h: number };
}

/**
 * Where a call to an empty side is drawn: under the parent, toward that side,
 * in the room the layout keeps under every level for a note — so it fits under
 * the deepest level too, clear of the strip, and never where a child could be.
 */
export function treeProbe(parent: TreePoint, side: 'left' | 'right'): TreeProbe {
  // Wide enough to hold `null` inside it: written beside the box, the word
  // ran off the canvas under the first and the last column.
  const w = 26;
  const h = 14;
  const cx = parent.cx + (side === 'left' ? -1 : 1) * COLUMN_W * 0.34;
  const y = parent.cy + TREE_NODE_R + 9;
  // Trimmed at the parent only: the box has no rim, and the line ends on it.
  const { x1, y1 } = rimToRim(parent, { cx, cy: y }, TREE_NODE_R);
  return {
    line: { x1, y1, x2: cx, y2: y },
    box: { x: cx - w / 2, y, w, h },
  };
}
