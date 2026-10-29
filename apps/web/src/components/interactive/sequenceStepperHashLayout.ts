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
  /**
   * A resize too wide for one row (#326 review, `grow`): `old` takes the top
   * strip, where the table was, and the table drawn while `resize` runs takes
   * this one, under it. `null` when the two fit side by side.
   */
  below: HashStrip | null;
  stacked: boolean;
}

/** Past this many positions between `old` and `table`, they are stacked instead of side by side. */
const SIDE_BY_SIDE = 12;
/**
 * The column of a position when the tables are stacked: eleven positions at
 * the usual pitch made the canvas wider than its panel, and every node
 * smaller (#326 review). A node and its link still fit, with the bypass clear
 * of the next column.
 */
const STACKED_PITCH = 72;

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
  const strip = (origin: number, dy = 0, pitch = PITCH): HashStrip => {
    const cx = (bucket: number) => origin + (bucket + 0.5) * pitch;
    const box = (bucket: number, y: number, w: number, h: number): HashBox => ({
      x: cx(bucket) - w / 2,
      y,
      w,
      h,
      cx: cx(bucket),
    });
    return {
      cell: (bucket) => box(bucket, dy + cellY, pitch === PITCH ? CELL_W : pitch, CELL_H),
      index: (bucket) => ({ x: cx(bucket), y: dy + cellY - 7 }),
      node: (bucket, k) => box(bucket, dy + nodeY(k), NODE_W, NODE_H),
      band: (bucket) => box(bucket, dy + bandY, NODE_W, NODE_H),
      nullAt: (bucket, length) => ({
        x: cx(bucket),
        y: dy + (length === 0 ? cellY + CELL_H / 2 + 4 : nodeY(length) - GAP + 13),
      }),
      bypassX: (bucket) => cx(bucket) + NODE_W / 2 + 12,
      name: { x: origin - 8, y: dy + cellY + CELL_H / 2 + 4 },
    };
  };
  const stripH = nodeY(Math.max(longest, 1)) - GAP + NULL_H;
  if (oldBuckets > 0 && oldBuckets + buckets > SIDE_BY_SIDE) {
    const origin = PAD + NAME_W;
    const top = strip(origin, 0, STACKED_PITCH);
    return {
      ...top,
      width: origin + buckets * STACKED_PITCH + PAD,
      height: 2 * stripH + SEP + PAD,
      old: top,
      below: strip(origin, stripH + SEP, STACKED_PITCH),
      stacked: true,
    };
  }
  const named = oldBuckets > 0;
  const oldOrigin = PAD + NAME_W;
  const tableOrigin = named ? oldOrigin + oldBuckets * PITCH + SEP + NAME_W : PAD;
  return {
    ...strip(tableOrigin),
    width: tableOrigin + buckets * PITCH + PAD,
    height: stripH + PAD,
    old: named ? strip(oldOrigin) : null,
    below: null,
    stacked: false,
  };
}

// ── the probing table: keys in the array itself (#326) ────────────────────

/** Horizontal room per position: a key sits inside its cell, so a cell is narrower than a list's column. */
const PROBE_PITCH = 80;
const PROBE_CELL_H = 34;
/** The `deleted` strip under `keys`: one boolean per position. */
const MARK_H = 20;
/** Room under `deleted` for the cursor `i`: an arrow up, its name under it. */
const CURSOR_H = 34;
/** Room left of the strips for their names, `keys` and `deleted`. */
const PROBE_NAME_W = 64;

/** One table of the probing recipe: `keys` and `deleted`, and the cursor under them. */
export interface ProbeStrip {
  /** `keys[i]`. */
  cell: (bucket: number) => HashBox;
  /** `deleted[i]`, right under its key. */
  mark: (bucket: number) => HashBox;
  index: (bucket: number) => { x: number; y: number };
  /** The band over a cell, where the key looked for and its hash are written. */
  band: (bucket: number) => HashBox;
  /** The cursor `i` under a cell: an arrow from `tail` up to `tip`, its name at `label`. */
  cursor: (bucket: number) => { x: number; tip: number; tail: number; label: number };
  names: { keys: { x: number; y: number }; deleted: { x: number; y: number } };
}

export interface ProbeLayout extends ProbeStrip {
  width: number;
  height: number;
  /**
   * A resize (`grow`, #326 review): `oldKeys` and `oldDeleted` on the top
   * strip, where the table was, and the new arrays on `below` while `resize`
   * runs. Both `null` when the run never resizes.
   */
  old: ProbeStrip | null;
  below: ProbeStrip | null;
}

/** Room left of the strips for `oldKeys` and `oldDeleted`, when a resize draws them. */
const PROBE_OLD_NAME_W = 92;

/**
 * `keys` and `deleted` are two arrays the class declares side by side, so
 * they are drawn as two contiguous strips, one over the other, each cell of
 * `deleted` right under the key it marks — and both named, as the listing
 * names them. The cursor `i` is the listing's too, and walks under them. A run
 * that resizes (`oldBuckets`) stacks two such tables, the old over the new,
 * columns aligned.
 */
export function layoutProbe(buckets: number, oldBuckets = 0): ProbeLayout {
  const resizing = oldBuckets > 0;
  const origin = PAD + (resizing ? PROBE_OLD_NAME_W : PROBE_NAME_W);
  const cx = (bucket: number) => origin + (bucket + 0.5) * PROBE_PITCH;
  const bandY = PAD;
  const cellY = bandY + BAND_H + INDEX_H;
  const markY = cellY + PROBE_CELL_H;
  const cursorY = markY + MARK_H;
  const tableH = cursorY + CURSOR_H;
  const strip = (dy: number): ProbeStrip => {
    const box = (bucket: number, y: number, w: number, h: number): HashBox => ({
      x: cx(bucket) - w / 2,
      y: dy + y,
      w,
      h,
      cx: cx(bucket),
    });
    return {
      cell: (bucket) => box(bucket, cellY, PROBE_PITCH, PROBE_CELL_H),
      mark: (bucket) => box(bucket, markY, PROBE_PITCH, MARK_H),
      index: (bucket) => ({ x: cx(bucket), y: dy + cellY - 7 }),
      band: (bucket) => box(bucket, bandY, NODE_W, NODE_H),
      cursor: (bucket) => ({
        x: cx(bucket),
        tip: dy + cursorY + 3,
        tail: dy + cursorY + 18,
        label: dy + cursorY + 30,
      }),
      names: {
        keys: { x: origin - 8, y: dy + cellY + PROBE_CELL_H / 2 + 4 },
        deleted: { x: origin - 8, y: dy + markY + MARK_H / 2 + 4 },
      },
    };
  };
  const top = strip(0);
  return {
    ...top,
    width: origin + buckets * PROBE_PITCH + PAD,
    height: resizing ? 2 * tableH + SEP + PAD : tableH + PAD,
    old: resizing ? top : null,
    below: resizing ? strip(tableH + SEP) : null,
  };
}
