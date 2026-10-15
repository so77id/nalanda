/**
 * Geometry for `<BinaryPicture>`, as a pure module (`apps/web/CLAUDE.md` §2):
 * where every node sits and how big the canvas is, so the suite checks it
 * exactly and the browser is left to confirm only that it looks right.
 *
 * The placement is the binary-tree recipe's (`sequenceStepperTreeLayout.ts`):
 * a node sits in the COLUMN of its inorder position and on the ROW of its
 * depth, with the sizes of `../treeGeometry.ts`, so a static figure and the
 * widget beside it draw the same tree. What the picture adds around the tree —
 * level labels, a ruler, notes, empty calls, frames, a strip, a row of chips, a
 * caption — only reserves room here; the component paints it.
 */

import { TREE_COLUMN_W, TREE_LEVEL_H, TREE_NODE_R, TREE_PAD, TREE_SLOT_H } from '../treeGeometry';

/** A value in a node: a number, or a symbol such as an expression's operator. */
export type TreeValue = number | string;

/** A binary tree as a document writes it: `{ v, l, r }`, a side left out when empty. */
export interface BinaryTreeShape {
  v: TreeValue;
  l?: BinaryTreeShape | null;
  r?: BinaryTreeShape | null;
}

export interface PlacedNode {
  value: TreeValue;
  /** The value as a key: tones, badges and notes are written `{ 3: 'focus' }`. */
  key: string;
  /** Inorder position, from 0. */
  column: number;
  depth: number;
  parent: PlacedNode | null;
  left: PlacedNode | null;
  right: PlacedNode | null;
}

export interface PlacedTree {
  root: PlacedNode;
  /** Every node, in inorder: the order of the columns. */
  nodes: PlacedNode[];
  /** How many columns the tree takes: one per node. */
  columns: number;
  /** The deepest level, from 0 at the root. */
  depth: number;
}

export function placeTree(tree: BinaryTreeShape): PlacedTree {
  const nodes: PlacedNode[] = [];
  const walk = (t: BinaryTreeShape, depth: number, parent: PlacedNode | null): PlacedNode => {
    const me: PlacedNode = {
      value: t.v,
      key: String(t.v),
      column: 0,
      depth,
      parent,
      left: null,
      right: null,
    };
    me.left = t.l ? walk(t.l, depth + 1, me) : null;
    me.column = nodes.length;
    nodes.push(me);
    me.right = t.r ? walk(t.r, depth + 1, me) : null;
    return me;
  };
  const root = walk(tree, 0, null);
  return {
    root,
    nodes,
    columns: nodes.length,
    depth: Math.max(...nodes.map((n) => n.depth)),
  };
}

/**
 * The first value that appears twice, as its key, or undefined. Tones, badges
 * and notes are keyed by value, so two nodes with one key would share them.
 */
export function repeatedValue(nodes: PlacedNode[]): string | undefined {
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.key)) return n.key;
    seen.add(n.key);
  }
  return undefined;
}

/** Room each optional decoration takes, so the layout reserves it. */
export interface PictureOptions {
  /** Figures set three in a row: narrower columns and levels. */
  compact?: boolean;
  /** "nivel 0", "nivel 1", … at the left of every level. */
  levels?: boolean;
  /** The height drawn at the left, as a ruler. */
  ruler?: boolean;
  /** One note per level at the right. */
  levelNotes?: boolean;
  /** A note under some node. */
  notes?: boolean;
  /** Empty subtrees, or an empty call, drawn under the nodes. */
  holes?: boolean;
  /** A dashed box around some subtree, with its name under it. */
  frames?: boolean;
  /** One slot per column under the tree. */
  strip?: boolean;
  /**
   * A binary search's divisions: one row per level under the tree, each
   * node's stretch of the sorted array in it. The first row is the strip.
   */
  splits?: boolean;
  /** Width of the row of chips under the tree, when it is drawn. */
  sequenceWidth?: number;
  caption?: string;
  /**
   * The deepest level anything is drawn down to, when it is past the tree's
   * own depth: a tall subtree reaches a level under the row it hangs on.
   */
  reach?: number;
  /** Columns to make room for at least, so figures side by side match. */
  minColumns?: number;
}

export interface PictureCanvas {
  r: number;
  pitch: number;
  levelH: number;
  pad: number;
  width: number;
  /** Everything above the caption. */
  height: number;
  /** The tree, with its notes, empty calls, frames and strip. */
  treeHeight: number;
  /** The tree and the row of chips under it. */
  fullHeight: number;
  /** Top of the strip. */
  stripY: number;
  /** Top of the row of splits of a level; the first is the strip's. */
  splitRowY: (depth: number) => number;
  /** Top of the row of chips. */
  sequenceY: number;
  /** Where the drawing starts: it is centred in a canvas a caption or chips widened. */
  offset: number;
  /** Width of the drawing proper, from its labels to its level notes. */
  drawingWidth: number;
  /** Room at the left for the level labels and the ruler. */
  labelWidth: number;
  /** Room at the right for the level notes. */
  noteWidth: number;
  /** Room under every level for an empty call. */
  holeRoom: number;
  cx: (n: PlacedNode) => number;
  cy: (n: PlacedNode) => number;
  /** The y of a level. */
  rowY: (depth: number) => number;
}

/** The gap between two rows of splits. */
export const SPLIT_GAP = 8;

/** A chip of the visit sequence, as wide as its value. */
export const chipWidth = (value: TreeValue): number => String(value).length * 9 + 40;
/** The gap between two chips, where the arrow goes. */
export const CHIP_GAP = 20;

/** How wide the row of chips is for these values. */
export function sequenceWidth(values: TreeValue[]): number {
  return values.reduce<number>((w, v, i) => w + chipWidth(v) + (i > 0 ? CHIP_GAP : 0), 0);
}

export function layoutPicture(placed: PlacedTree, options: PictureOptions): PictureCanvas {
  const r = TREE_NODE_R;
  // compact narrows the columns for figures set three in a row, so each fills its own column at full size.
  const pitch = options.compact ? 38 : TREE_COLUMN_W;
  const levelH = options.compact ? 50 : TREE_LEVEL_H;
  const pad = TREE_PAD;
  const labelWidth = (options.levels ? 58 : 0) + (options.ruler ? 46 : 0);
  const noteWidth = options.levelNotes ? 72 : 0;
  const holeRoom = options.holes ? 26 : 0;
  const frameRoom = options.frames ? 22 : 0;
  // The strip goes under everything a level can carry, one slot per column.
  const deepest = Math.max(placed.depth, options.reach ?? 0);
  const stripY =
    2 * pad + 2 * r + deepest * levelH + (options.notes ? 12 : 0) + holeRoom + frameRoom + 6;
  const splitRowY = (depth: number) => stripY + depth * (TREE_SLOT_H + SPLIT_GAP);
  const treeHeight = options.splits
    ? splitRowY(placed.depth) + TREE_SLOT_H + pad
    : options.strip
      ? stripY + TREE_SLOT_H + pad
      : stripY - 6;
  const drawn = options.sequenceWidth !== undefined;
  const fullHeight = treeHeight + (drawn ? 42 : 0);
  // minColumns gives figures set side by side one canvas width; the tree is centred in it.
  const columns = Math.max(placed.columns, options.minColumns ?? 0, 1);
  const shift = ((columns - placed.columns) / 2) * pitch;
  // A caption, or the row of chips, wider than the drawing widens the canvas, and the drawing is centred in it.
  const drawingWidth = labelWidth + 2 * pad + columns * pitch + noteWidth;
  const width = Math.max(
    drawingWidth,
    options.caption ? options.caption.length * 6.6 + 24 : 0,
    (options.sequenceWidth ?? 0) + 2 * pad,
  );
  const offset = (width - drawingWidth) / 2;
  const rowY = (depth: number) => pad + r + depth * levelH;
  return {
    r,
    pitch,
    levelH,
    pad,
    width,
    height: fullHeight + (options.caption ? 20 : 0),
    treeHeight,
    fullHeight,
    stripY,
    splitRowY,
    sequenceY: treeHeight + 6,
    offset,
    drawingWidth,
    labelWidth,
    noteWidth,
    holeRoom,
    cx: (n) => offset + labelWidth + pad + shift + (n.column + 0.5) * pitch,
    cy: (n) => rowY(n.depth),
    rowY,
  };
}
