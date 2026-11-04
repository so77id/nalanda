import { TREE_NODE_R } from '../treeGeometry';

/** A node of the drawing: its value, and its place on the grid in columns and rows. */
export interface NodeGraphNode {
  v: number | string;
  /** Column, from 0; a half places it between two columns. */
  x: number;
  /** Row, from 0 at the top. */
  y: number;
}

/** An edge, from one node's value to another's, with an optional weight written on it. */
export type NodeGraphEdge =
  [number | string, number | string] | [number | string, number | string, number | string];

export interface Point {
  x: number;
  y: number;
}

/** One edge as drawn: its path, its arrowhead if the graph is directed, its weight's place. */
export interface LaidEdge {
  /** `from>to`, as the author wrote it. Parallel edges share it. */
  key: string;
  from: string;
  to: string;
  /** The SVG path, trimmed at both nodes' borders (and at the arrowhead's base). */
  d: string;
  /** The arrowhead's three corners, the tip first, when the graph is directed. */
  arrow?: string;
  weight?: string;
  /** Where the weight's chip goes: the middle of the drawn edge. */
  weightAt?: Point;
}

export interface NodeGraphLayout {
  width: number;
  /** The drawing's height without the caption. */
  drawingH: number;
  /** Each node's centre, keyed by its value as a string. */
  at: Map<string, Point>;
  /**
   * Each node's half width: the circle's radius, or more for a label longer
   * than two characters, which turns the circle into a pill.
   */
  halfW: Map<string, number>;
  edges: LaidEdge[];
  /** Where a note beside each node goes: the side its edges leave most free. */
  noteAt: Map<string, Point>;
}

export interface NodeGraphLayoutInput {
  nodes: NodeGraphNode[];
  edges: NodeGraphEdge[];
  cols: number;
  rows: number;
  directed: boolean;
  /** The caption's length, which may widen the drawing. */
  captionChars?: number;
}

export const NODE_R = TREE_NODE_R;
export const PITCH = 52;
export const LEVEL_H = 58;
export const PAD = 18;
/** How far apart two edges between the same two nodes bulge, at their middle. */
export const BEND = 14;
export const ARROW_L = 9;
export const ARROW_HALF_W = 4.5;
/** How far beyond a node's border its note sits. */
export const NOTE_GAP = 10;
/** The width of one character of a node's label (14 px, semibold), for a pill. */
export const LABEL_CHAR_W = 8.4;
/** The least room left between a pill and the drawing's side. */
const SIDE_MARGIN = 6;

const unit = (dx: number, dy: number): Point => {
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A node's half width: a circle up to two characters, a pill beyond. */
export function nodeHalfWidth(label: string): number {
  const chars = [...label].length;
  return chars <= 2 ? NODE_R : Math.max(NODE_R, (chars * LABEL_CHAR_W + 16) / 2);
}

/**
 * How far from a node's centre its border is, in the direction `u` (a unit
 * vector). A pill is the set of points within the radius of a horizontal
 * segment; a circle is the pill whose segment has no length.
 */
export function borderDistance(halfW: number, u: Point): number {
  const r = NODE_R;
  const a = halfW - r;
  if (a <= 0) return r;
  if (u.y !== 0) {
    const flat = r / Math.abs(u.y);
    if (Math.abs(flat * u.x) <= a) return flat;
  }
  return a * Math.abs(u.x) + Math.sqrt(r * r - a * a * u.y * u.y);
}

/**
 * Where every node and every edge goes. Pure, so the suite checks the geometry
 * exactly and the browser only confirms that it looks right.
 *
 * Edges between the same two nodes — the two bridges between one bank and the
 * island, or `a → b` beside `b → a` — are spread symmetrically on either side
 * of the straight line, so none hides another; a lone edge stays straight.
 */
export function layoutNodeGraph({
  nodes,
  edges,
  cols,
  rows,
  directed,
  captionChars = 0,
}: NodeGraphLayoutInput): NodeGraphLayout {
  const r = NODE_R;
  const drawingW = 2 * PAD + cols * PITCH;
  let width = Math.max(drawingW, captionChars ? captionChars * 6.6 + 24 : 0);
  let offset = (width - drawingW) / 2;
  const drawingH = 2 * PAD + 2 * r + (rows - 1) * LEVEL_H;
  const halfW = new Map(nodes.map((n) => [String(n.v), nodeHalfWidth(String(n.v))]));

  // A pill in the first or last column may reach past the grid: make room.
  const gridX = (n: NodeGraphNode) => PAD + (n.x + 0.5) * PITCH;
  const left = Math.min(...nodes.map((n) => offset + gridX(n) - halfW.get(String(n.v))!));
  if (left < SIDE_MARGIN) {
    offset += SIDE_MARGIN - left;
    width += SIDE_MARGIN - left;
  }
  const right = Math.max(...nodes.map((n) => offset + gridX(n) + halfW.get(String(n.v))!));
  if (right > width - SIDE_MARGIN) width = right + SIDE_MARGIN;

  const at = new Map<string, Point>(
    nodes.map((n) => [String(n.v), { x: offset + gridX(n), y: PAD + r + n.y * LEVEL_H }]),
  );

  // Group the edges by the unordered pair they join, to spread the parallels.
  const pairOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const groups = new Map<string, number>();
  for (const [a, b] of edges) {
    const k = pairOf(String(a), String(b));
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  // The directions in which edges leave each node, to keep notes off them.
  const leaving = new Map<string, number[]>([...at.keys()].map((k) => [k, []]));

  const laid = edges.map((edge): LaidEdge => {
    const from = String(edge[0]);
    const to = String(edge[1]);
    const pair = pairOf(from, to);
    const n = groups.get(pair)!;
    const i = seen.get(pair) ?? 0;
    seen.set(pair, i + 1);
    const p = at.get(from)!;
    const q = at.get(to)!;
    // The normal of the pair's CANONICAL direction, so a → b and b → a bend apart.
    const [u, v] = from < to ? [p, q] : [q, p];
    const t = unit(v.x - u.x, v.y - u.y);
    const normal = { x: -t.y, y: t.x };
    const bulge = (i - (n - 1) / 2) * 2 * BEND;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    // A quadratic curve's middle sits halfway to its control point.
    const c = { x: mid.x + normal.x * bulge * 2, y: mid.y + normal.y * bulge * 2 };
    const out = unit(c.x - p.x, c.y - p.y);
    const inn = unit(q.x - c.x, q.y - c.y);
    leaving.get(from)!.push(Math.atan2(out.y, out.x));
    leaving.get(to)!.push(Math.atan2(-inn.y, -inn.x));
    const startGap = borderDistance(halfW.get(from)!, out);
    const endGap = borderDistance(halfW.get(to)!, { x: -inn.x, y: -inn.y });
    const start = { x: p.x + out.x * startGap, y: p.y + out.y * startGap };
    const tip = { x: q.x - inn.x * endGap, y: q.y - inn.y * endGap };
    const end = directed
      ? { x: tip.x - inn.x * ARROW_L * 0.8, y: tip.y - inn.y * ARROW_L * 0.8 }
      : tip;
    const d =
      bulge === 0
        ? `M${r1(start.x)},${r1(start.y)} L${r1(end.x)},${r1(end.y)}`
        : `M${r1(start.x)},${r1(start.y)} Q${r1(c.x)},${r1(c.y)} ${r1(end.x)},${r1(end.y)}`;
    let arrow: string | undefined;
    if (directed) {
      const base = { x: tip.x - inn.x * ARROW_L, y: tip.y - inn.y * ARROW_L };
      const side = { x: -inn.y * ARROW_HALF_W, y: inn.x * ARROW_HALF_W };
      arrow = [
        [tip.x, tip.y],
        [base.x + side.x, base.y + side.y],
        [base.x - side.x, base.y - side.y],
      ]
        .map(([x, y]) => `${r1(x)},${r1(y)}`)
        .join(' ');
    }
    const weight = edge.length === 3 ? String(edge[2]) : undefined;
    const weightAt =
      weight === undefined
        ? undefined
        : { x: r1(mid.x + normal.x * bulge), y: r1(mid.y + normal.y * bulge) };
    return { key: `${from}>${to}`, from, to, d, arrow, weight, weightAt };
  });

  const noteAt = new Map<string, Point>();
  for (const [k, p] of at) {
    const dirs = leaving.get(k)!;
    let best = NOTE_DIRECTIONS[0];
    let bestGap = -1;
    for (const a of NOTE_DIRECTIONS) {
      const gap = dirs.length === 0 ? Math.PI : Math.min(...dirs.map((d) => angleBetween(a, d)));
      // Strictly greater: on a tie the earlier direction (upper right first) wins.
      if (gap > bestGap + 1e-9) {
        best = a;
        bestGap = gap;
      }
    }
    const u = { x: Math.cos(best), y: Math.sin(best) };
    const reach = borderDistance(halfW.get(k)!, u) + NOTE_GAP;
    noteAt.set(k, { x: r1(p.x + u.x * reach), y: r1(p.y + u.y * reach) });
  }

  return { width, drawingH, at, halfW, edges: laid, noteAt };
}

/** Eight directions, upper right first, then clockwise — SVG's y grows downwards. */
const NOTE_DIRECTIONS = [-1, 0, 1, 2, 3, 4, 5, 6].map((i) => (i * Math.PI) / 4);

const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};
