import { HASH_CELL_H, HASH_NODE_KEY_H, HASH_NODE_LINK_H } from '../hashGeometry';
import { captionWidth } from './figureText';

/**
 * Where `<ChainTable>` puts its strip, its lists and its nodes, as numbers the
 * suite can check (apps/web/CLAUDE.md: the way out is to not measure). The
 * heights come from `hashGeometry.ts`, shared with the widget; the pitch and the
 * node width are the figure's own, one pair per size.
 */

/** How wide a node is drawn: for a short name, or for a RUT. */
export type ChainTableSize = 'name' | 'rut';

interface SizeSpec {
  /** Width of a position: a cell takes the whole pitch, so the strip is contiguous. */
  pitch: number;
  nodeW: number;
  /** Height of the key field. */
  keyH: number;
  /** Font size of the key. */
  keyFont: number;
}

export const CHAIN_TABLE_SIZES: Record<ChainTableSize, SizeSpec> = {
  // Tablas Hash's names (`Ana`, `Sara`): the widget's key field, at a
  // narrower pitch than the widget's 96, so seven positions fit beside prose.
  name: { pitch: 78, nodeW: 56, keyH: HASH_NODE_KEY_H, keyFont: 13 },
  // Set y Map's RUTs (`13.180.992-1`), twice as wide as a name, in a key field
  // two units taller than the widget's for the smaller face that fits them:
  // the one height this size does not take from `hashGeometry.ts`.
  rut: { pitch: 108, nodeW: 98, keyH: 24, keyFont: 12.5 },
};

/** Height of the band under the key that a map's node adds for its value. */
export const CHAIN_VALUE_H = 20;

const PAD = 12;
/** Room between the strip and the first node, and between two nodes. */
const GAP = 18;
/** Where the index of a cell is written. */
const INDEX_Y = 18;
/** The y of the strip's top edge. */
const CELL_Y = 26;

export interface ChainTableLayoutOptions {
  size?: ChainTableSize;
  /** Whether nodes carry a value band. */
  values?: boolean;
  /** Only the positions from `[0]` to `[1]`, both included. */
  window?: [number, number];
  caption?: string;
}

export interface ChainTableLayout {
  width: number;
  height: number;
  /** The first and the last position drawn. */
  lo: number;
  hi: number;
  /** The x of the strip's left edge. */
  left: number;
  stripW: number;
  pitch: number;
  cellY: number;
  cellH: number;
  indexY: number;
  nodeW: number;
  keyH: number;
  keyFont: number;
  valueH: number;
  linkH: number;
  nodeH: number;
  /** The x of the left edge of position `i`'s cell. */
  cellX: (i: number) => number;
  /** The x of the centre of position `i`'s column. */
  cx: (i: number) => number;
  /** The y of the top of the `k`-th node of a list, 0 the first. */
  nodeY: (k: number) => number;
  /** The y of the middle of the `k`-th node's link field, where its reference starts. */
  linkY: (k: number) => number;
  /**
   * The link that skips the `k`-th node of position `i`'s list of `length`
   * nodes, as two paths: the line, from the reference that pointed at the
   * node — the cell's, for the first — out to its right and down, and the
   * head, onto the node after it or, past the last, beside its `null`.
   */
  bypass: (i: number, length: number, k: number) => { line: string; head: string };
}

export function chainTableLayout(
  chains: readonly (readonly string[])[],
  { size = 'name', values = false, window, caption }: ChainTableLayoutOptions = {},
): ChainTableLayout {
  const { pitch, nodeW, keyH, keyFont } = CHAIN_TABLE_SIZES[size];
  const valueH = values ? CHAIN_VALUE_H : 0;
  const nodeH = keyH + valueH + HASH_NODE_LINK_H;
  const [lo, hi] = window ?? [0, chains.length - 1];
  const longest = Math.max(1, ...chains.slice(lo, hi + 1).map((c) => c.length));
  const stripW = (hi - lo + 1) * pitch;
  const width = Math.max(2 * PAD + stripW + (window ? 40 : 0), captionWidth(caption));
  const left = (width - stripW) / 2;
  const nodeY = (k: number) => CELL_Y + HASH_CELL_H + GAP + k * (nodeH + GAP);
  const height = nodeY(longest) - GAP + 18 + (caption ? 30 : 6);
  const cellX = (i: number) => left + (i - lo) * pitch;
  const cx = (i: number) => cellX(i) + pitch / 2;
  const linkY = (k: number) => nodeY(k) + keyH + valueH + HASH_NODE_LINK_H / 2;
  const bypass = (i: number, length: number, k: number) => {
    const c = cx(i);
    const fromY = k === 0 ? CELL_Y + HASH_CELL_H / 2 : linkY(k - 1);
    const last = k === length - 1;
    const endY = last ? nodeY(k) + nodeH + 9 : nodeY(k + 1) + 8;
    const endX = last ? c + 14 : c + nodeW / 2 + 1;
    const x = c + nodeW / 2 + 12;
    return {
      line: `M ${c} ${fromY} H ${x} V ${endY} H ${endX + 6}`,
      head: `M ${endX + 7} ${endY - 4} L ${endX} ${endY} L ${endX + 7} ${endY + 4} z`,
    };
  };
  return {
    width,
    height,
    lo,
    hi,
    left,
    stripW,
    pitch,
    cellY: CELL_Y,
    cellH: HASH_CELL_H,
    indexY: INDEX_Y,
    nodeW,
    keyH,
    keyFont,
    valueH,
    linkH: HASH_NODE_LINK_H,
    nodeH,
    cellX,
    cx,
    nodeY,
    linkY,
    bypass,
  };
}
