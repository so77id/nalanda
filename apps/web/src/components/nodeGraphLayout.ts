import { TREE_NODE_R } from './treeGeometry';

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
  /** Where the weight is written: the middle of the drawn edge, or just past a self-loop's apex. */
  weightAt?: Point;
  /**
   * The edge as a quadratic curve. A straight edge runs between the two node
   * centres, with its control point in the middle; a bent one is the curve as
   * drawn, trimmed at the borders and at an arrowhead's base. Either way its
   * middle is on the drawn line. `pointOnEdge` reads it.
   */
  curve: { from: Point; control: Point; to: Point };
}

/**
 * The point a fraction `t` of the way along an edge's `curve`, from the end
 * at its `from` node (t = 0) to the end at its `to` node (t = 1). At t = 1/2
 * it is the middle of the drawn line, on its bulge when it is one of several
 * parallel edges.
 */
export function pointOnEdge(edge: LaidEdge, t: number): Point {
  const { from, control, to } = edge.curve;
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return {
    x: r1(a * from.x + b * control.x + c * to.x),
    y: r1(a * from.y + b * control.y + c * to.y),
  };
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
  /**
   * Stop each edge at its nodes' borders (the default), or run it from centre
   * to centre, as the strokes of a figure meet at its points.
   */
  trim?: boolean;
  /** The nodes that carry a note: the drawing grows if one falls below its last row. */
  noted?: string[];
}

export const NODE_R = TREE_NODE_R;
const PITCH = 52;
const LEVEL_H = 58;
const PAD = 18;
/** How far apart two edges between the same two nodes bulge, at their middle. */
const BEND = 14;
const ARROW_L = 9;
const ARROW_HALF_W = 4.5;
/** How far beyond a node's border its note sits. */
const NOTE_GAP = 10;
/** The width of one character of a node's label (14 px, semibold), for a pill. */
const LABEL_CHAR_W = 8.4;
/** The least room left between a pill and the drawing's side. */
const SIDE_MARGIN = 6;

const unit = (dx: number, dy: number): Point => {
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A node's half width: a circle up to two characters, a pill beyond. */
function nodeHalfWidth(label: string): number {
  const chars = [...label].length;
  return chars <= 2 ? NODE_R : Math.max(NODE_R, (chars * LABEL_CHAR_W + 16) / 2);
}

/**
 * How far from a node's centre its border is, in the direction `u` (a unit
 * vector). A pill is the set of points within the radius of a horizontal
 * segment; a circle is the pill whose segment has no length.
 */
function borderDistance(halfW: number, u: Point): number {
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
  trim = true,
  noted = [],
}: NodeGraphLayoutInput): NodeGraphLayout {
  const r = NODE_R;
  const drawingW = 2 * PAD + cols * PITCH;
  let width = Math.max(drawingW, captionChars ? captionChars * 6.6 + 24 : 0);
  let offset = (width - drawingW) / 2;
  let drawingH = 2 * PAD + 2 * r + (rows - 1) * LEVEL_H;
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

  const laid = edges.map((edge): LaidEdge | null => {
    const from = String(edge[0]);
    const to = String(edge[1]);
    if (from === to) return null; // A self-loop: laid below, once the other edges are.
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
    const startGap = trim ? borderDistance(halfW.get(from)!, out) : 0;
    const endGap = trim ? borderDistance(halfW.get(to)!, { x: -inn.x, y: -inn.y }) : 0;
    const start = { x: p.x + out.x * startGap, y: p.y + out.y * startGap };
    const tip = { x: q.x - inn.x * endGap, y: q.y - inn.y * endGap };
    const end = directed
      ? { x: tip.x - inn.x * ARROW_L * 0.8, y: tip.y - inn.y * ARROW_L * 0.8 }
      : tip;
    const d =
      bulge === 0
        ? `M${r1(start.x)},${r1(start.y)} L${r1(end.x)},${r1(end.y)}`
        : `M${r1(start.x)},${r1(start.y)} Q${r1(c.x)},${r1(c.y)} ${r1(end.x)},${r1(end.y)}`;
    // A bent edge is drawn trimmed, so its weight and step numbers follow the
    // drawn curve: its middle is ¼·start + ½·control + ¼·end. Keeping the
    // control `c` keeps the curve leaving along `out` and arriving along `inn`,
    // the direction its arrowhead is built on.
    const drawn =
      bulge === 0 ? { from: p, control: c, to: q } : { from: start, control: c, to: end };
    const middle = {
      x: drawn.from.x / 4 + drawn.control.x / 2 + drawn.to.x / 4,
      y: drawn.from.y / 4 + drawn.control.y / 2 + drawn.to.y / 4,
    };
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
    const weightAt = weight === undefined ? undefined : { x: r1(middle.x), y: r1(middle.y) };
    const curve = drawn;
    return { key: `${from}>${to}`, from, to, d, arrow, weight, weightAt, curve };
  });

  // Self-loops leave their node where its other edges leave the most room,
  // a second loop on the same node a little larger than the first.
  const loopsAt = new Map<string, number>();
  edges.forEach((edge, k) => {
    const v = String(edge[0]);
    if (v !== String(edge[1])) return;
    const p = at.get(v)!;
    const i = loopsAt.get(v) ?? 0;
    loopsAt.set(v, i + 1);
    const dirs = leaving.get(v)!;
    const angle = freestDirection(dirs);
    dirs.push(angle);
    // Built from the point where the loop's direction meets the node's border,
    // so a wide pill gets as round a loop as a circle does.
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const n = { x: -u.y, y: u.x };
    const border = trim ? borderDistance(halfW.get(v)!, u) : 0;
    const base = { x: p.x + u.x * (border - 2), y: p.y + u.y * (border - 2) };
    const len = LOOP_LEN * (1 + 0.45 * i);
    const along = (k: number, side: number) => ({
      x: base.x + u.x * k + n.x * side,
      y: base.y + u.y * k + n.y * side,
    });
    const s0 = along(0, LOOP_FOOT);
    const tip = along(0, -LOOP_FOOT);
    const c1 = along(len, len * 0.75);
    const c2 = along(len, -len * 0.75);
    const inn = unit(tip.x - c2.x, tip.y - c2.y);
    const end = directed
      ? { x: tip.x - inn.x * ARROW_L * 0.8, y: tip.y - inn.y * ARROW_L * 0.8 }
      : tip;
    const d = `M${r1(s0.x)},${r1(s0.y)} C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${r1(end.x)},${r1(end.y)}`;
    let arrow: string | undefined;
    if (directed) {
      const back = { x: tip.x - inn.x * ARROW_L, y: tip.y - inn.y * ARROW_L };
      const side = { x: -inn.y * ARROW_HALF_W, y: inn.x * ARROW_HALF_W };
      arrow = [
        [tip.x, tip.y],
        [back.x + side.x, back.y + side.y],
        [back.x - side.x, back.y - side.y],
      ]
        .map(([x, y]) => `${r1(x)},${r1(y)}`)
        .join(' ');
    }
    // A cubic's middle sits three quarters of the way to its control points.
    const apex = along(len * 0.75, 0);
    const weight = edge.length === 3 ? String(edge[2]) : undefined;
    const weightAt =
      weight === undefined ? undefined : { x: r1(apex.x + u.x * 12), y: r1(apex.y + u.y * 12) };
    // A quadratic through the apex at its middle, so pointOnEdge finds the loop.
    const curve = { from: p, control: { x: 2 * apex.x - p.x, y: 2 * apex.y - p.y }, to: p };
    laid[k] = { key: `${v}>${v}`, from: v, to: v, d, arrow, weight, weightAt, curve };
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

  // A note under a node of the last row would sit on the caption: make room.
  for (const k of noted) {
    const note = noteAt.get(String(k));
    if (note && note.y + NOTE_GAP + 8 > drawingH) drawingH = note.y + NOTE_GAP + 8;
  }

  return { width, drawingH, at, halfW, edges: laid as LaidEdge[], noteAt };
}

/** Eight directions, upper right first, then clockwise — SVG's y grows downwards. */
const NOTE_DIRECTIONS = [-1, 0, 1, 2, 3, 4, 5, 6].map((i) => (i * Math.PI) / 4);

/** How far a self-loop's control points reach past the node's border, and how far apart its two feet stand. */
const LOOP_LEN = 40;
const LOOP_FOOT = 8;

/**
 * Where a self-loop goes: straight up when its node's other edges leave a
 * sixth of a turn free on either side, otherwise the direction farthest from all of them.
 */
function freestDirection(dirs: number[]): number {
  const order = [6, 5, 7, 4, 0, 3, 1, 2].map((i) => (i * Math.PI) / 4);
  const gap = (a: number) =>
    dirs.length === 0 ? Math.PI : Math.min(...dirs.map((d) => angleBetween(a, d)));
  if (gap(order[0]) >= Math.PI / 3 - 1e-9) return order[0];
  let best = order[0];
  let bestGap = -1;
  for (const a of order) {
    if (gap(a) > bestGap + 1e-9) {
      best = a;
      bestGap = gap(a);
    }
  }
  return best;
}

const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

/** The circle that carries a step number on a walked edge. */
export const STEP_R = 7;

/**
 * How far a step number keeps from the others (two circles and a little air)
 * and from a vertex's centre (the vertex, the circle and a little air), and
 * how far it steps off its edge when the edge has no room left.
 */
export const STEP_SPACE = { gap: 2 * STEP_R + 2, clear: NODE_R + STEP_R + 1, side: STEP_R + 2 };

/**
 * The edge each step of a walk takes: for each pair of consecutive vertices,
 * the first edge between them not taken yet, so parallel edges are walked in
 * turn. In a directed graph an edge is taken only from its first vertex.
 * `null` when a step has no edge left to take.
 */
export function walkStrokes(
  edges: NodeGraphEdge[],
  walk: (string | number)[],
  directed: boolean,
): number[] | null {
  const used: number[] = [];
  for (let i = 0; i + 1 < walk.length; i++) {
    const a = String(walk[i]);
    const b = String(walk[i + 1]);
    const k = edges.findIndex(
      ([u, v], j) =>
        !used.includes(j) &&
        ((String(u) === a && String(v) === b) || (!directed && String(u) === b && String(v) === a)),
    );
    if (k === -1) return null;
    used.push(k);
  }
  return used;
}

/** A drawn stroke's step number and where it is written. */
export interface StepMark {
  stroke: number;
  step: number;
  x: number;
  y: number;
}

/**
 * Where along its stroke a step number may go, best first: the middle, then
 * a little nearer where the step began, a little nearer where it ended, and
 * so on outwards.
 */
const SPOTS = [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8, 0.14, 0.86];

/**
 * The step numbers of a tracing on a laid-out graph: each drawn stroke gets
 * the number of the step that drew it, at the middle of the stroke, or at the
 * first spot along it that is at least `STEP_SPACE.gap` from every number
 * written before and `STEP_SPACE.clear` from every point's centre. When the
 * stroke has no such spot — where several strokes cross — the number steps
 * `STEP_SPACE.side` off the stroke, beside it. Failing even that, it takes
 * the spot off the points that stands furthest from the numbers already
 * written.
 */
export function stepMarks(
  { edges, at }: Pick<NodeGraphLayout, 'edges' | 'at'>,
  trace: { path: string[]; used: number[] },
): StepMark[] {
  const { gap, clear, side } = STEP_SPACE;
  const marks: StepMark[] = [];
  const points = [...at.values()];
  const nearest = (p: Point, qs: Point[]) =>
    Math.min(Infinity, ...qs.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
  trace.used.forEach((k, i) => {
    const edge = edges[k];
    const forward = edge.from === trace.path[i];
    const along = (t: number) => pointOnEdge(edge, forward ? t : 1 - t);
    const beside = (t: number, sign: number) => {
      const p = along(t);
      const a = along(t - 0.01);
      const b = along(t + 0.01);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        x: p.x - ((b.y - a.y) / len) * side * sign,
        y: p.y + ((b.x - a.x) / len) * side * sign,
      };
    };
    const spots = [...SPOTS.map(along), ...SPOTS.flatMap((t) => [beside(t, 1), beside(t, -1)])];
    const clearOfPoints = spots.filter((p) => nearest(p, points) >= clear);
    const free =
      clearOfPoints.find((p) => nearest(p, marks) >= gap) ??
      [...(clearOfPoints.length > 0 ? clearOfPoints : spots)].sort(
        (p, q) => nearest(q, marks) - nearest(p, marks),
      )[0];
    marks.push({ stroke: k, step: i + 1, x: r1(free.x), y: r1(free.y) });
  });
  return marks;
}

/**
 * Two vertices drawn at the same spot, or two with the same value: an edge
 * between them has no direction to take, and its drawing comes out broken.
 * Returns the two values, or `null` when every vertex has its own place.
 */
export function crowdedVertices(nodes: NodeGraphNode[]): [string, string] | null {
  const seen = new Map<string, string>();
  for (const n of nodes) {
    const value = String(n.v);
    for (const key of [`v:${value}`, `p:${n.x},${n.y}`]) {
      const other = seen.get(key);
      if (other !== undefined) return [other, value];
      seen.set(key, value);
    }
  }
  return null;
}
