/**
 * Geometry for the hash recipe of `<SequenceStepper>` (#326), as a pure
 * module — the shape the heap's and the tree's layouts follow
 * (`apps/web/CLAUDE.md` §2): every coordinate the hash view paints comes from
 * here, so the suite checks it exactly and the browser is left to confirm only
 * that it looks right.
 *
 * `table` is drawn as the unit draws every array — a horizontal strip of cells
 * with their index — and the list of each position hangs DOWN from its cell,
 * one node under the other. Hanging rather than running sideways keeps every
 * position's list in that position's column, so the table stays one strip
 * wide however long a list grows, and a projected slide reads it at a glance.
 *
 * `table` is contiguous and its cells touch; the nodes hanging from them do
 * not, and the gap between two columns of nodes is where the references the
 * listing holds are named and where a link that skips a node runs.
 *
 * Above the strip there is one band, over the position the hash picked: the
 * key being searched for sits there, and so does the node `add` builds before
 * it enters its list — so the key and the node it becomes occupy one place.
 */

/** Horizontal room per position. */
const PITCH = 96;
/**
 * A cell of `table` takes the whole pitch, so the strip is contiguous: an
 * array is drawn flush, as `dynamic-array` draws it, and only the NODES — loose
 * objects in memory — stand apart (Miguel's review of S1).
 */
const CELL_W = PITCH;
const CELL_H = 30;
/** A node of a list: the key on top, its `next` field below. */
export const NODE_W = 60;
export const NODE_KEY_H = 22;
export const NODE_LINK_H = 12;
const NODE_H = NODE_KEY_H + NODE_LINK_H;
/** Vertical room between a cell and its first node, and between two nodes. */
const GAP = 20;
/** Margin around the drawing. */
const PAD = 14;
/** The band above the strip: the key, or the node built apart. */
const BAND_H = NODE_H;
/** Room between the band and the strip, where the index labels sit. */
const INDEX_H = 24;
/** Room under the last node for `null`. */
const NULL_H = 16;

export interface HashBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The centre of the column. */
  cx: number;
}

/** One array drawn as a strip, with the list of each position hanging under it. */
export interface HashStrip {
  /** `table[i]` (or `old[i]`). */
  cell: (bucket: number) => HashBox;
  /** Where the index of a cell is written: centred, above it. */
  index: (bucket: number) => { x: number; y: number };
  /** The `k`-th node of the list of `bucket`, 0 the first. */
  node: (bucket: number, k: number) => HashBox;
  /** The band above `bucket`: the key looked for, or the node `add` builds. */
  band: (bucket: number) => HashBox;
  /** Where `null` is written after a list of `length` nodes. */
  nullAt: (bucket: number, length: number) => { x: number; y: number };
  /** The x a link that skips a node runs down, right of the column's nodes. */
  bypassX: (bucket: number) => number;
  /** Where the strip's name (`table`, `old`) is written: right-aligned, left of its first cell. */
  name: { x: number; y: number };
}

/** The `table` strip, and — for `resize` only — the `old` strip to its left. */
export interface HashLayout extends HashStrip {
  width: number;
  height: number;
  old: HashStrip | null;
}

/** Room left of a named strip for its name. */
const NAME_W = 52;
/** Room between `old` and the name of `table`. */
const SEP = 24;

/**
 * `buckets` is `table.length` and `longest` the longest list any frame of the
 * run holds. Both come from the whole run, so the canvas keeps one size from
 * the first frame to the last. `oldBuckets` is given only by `resize`, which
 * draws the old table to the left of the new one, each strip named as the
 * listing names it; every other run draws one strip, unnamed, where it always
 * was.
 */
export function layoutHash(buckets: number, longest: number, oldBuckets = 0): HashLayout {
  const bandY = PAD;
  const cellY = bandY + BAND_H + INDEX_H;
  const nodeY = (k: number) => cellY + CELL_H + GAP + k * (NODE_H + GAP);
  const strip = (origin: number): HashStrip => {
    const cx = (bucket: number) => origin + (bucket + 0.5) * PITCH;
    const box = (bucket: number, y: number, w: number, h: number): HashBox => ({
      x: cx(bucket) - w / 2,
      y,
      w,
      h,
      cx: cx(bucket),
    });
    return {
      cell: (bucket) => box(bucket, cellY, CELL_W, CELL_H),
      index: (bucket) => ({ x: cx(bucket), y: cellY - 7 }),
      node: (bucket, k) => box(bucket, nodeY(k), NODE_W, NODE_H),
      band: (bucket) => box(bucket, bandY, NODE_W, NODE_H),
      nullAt: (bucket, length) => ({
        x: cx(bucket),
        y: length === 0 ? cellY + CELL_H / 2 + 4 : nodeY(length) - GAP + 13,
      }),
      bypassX: (bucket) => cx(bucket) + NODE_W / 2 + 12,
      name: { x: origin - 8, y: cellY + CELL_H / 2 + 4 },
    };
  };
  const named = oldBuckets > 0;
  const oldOrigin = PAD + NAME_W;
  const tableOrigin = named ? oldOrigin + oldBuckets * PITCH + SEP + NAME_W : PAD;
  return {
    ...strip(tableOrigin),
    width: tableOrigin + buckets * PITCH + PAD,
    height: nodeY(Math.max(longest, 1)) - GAP + NULL_H + PAD,
    old: named ? strip(oldOrigin) : null,
  };
}
