import { pointOnEdge, type NodeGraphEdge, type NodeGraphLayout } from '../nodeGraphLayout';

/** A tracing in progress: the points visited, in order, and the strokes drawn. */
export interface TraceState {
  /** The points visited, the first one being where the pen went down. */
  path: string[];
  /** The indices of the strokes drawn, in the order they were drawn. */
  used: number[];
}

/** Where a tracing stands: not started, under way, with no way on, or finished. */
export type TraceStatus = 'empty' | 'drawing' | 'stuck' | 'done';

export const EMPTY_TRACE: TraceState = { path: [], used: [] };

/** The stroke a step from `from` to `to` would draw: the first one not yet drawn. */
function freeStroke(
  edges: NodeGraphEdge[],
  used: number[],
  from: string,
  to: string,
): number | undefined {
  const taken = new Set(used);
  const i = edges.findIndex(
    ([a, b], k) =>
      !taken.has(k) &&
      ((String(a) === from && String(b) === to) || (String(a) === to && String(b) === from)),
  );
  return i === -1 ? undefined : i;
}

/**
 * The tracing after pressing on point `v`: the pen goes down if it is up, and
 * otherwise it draws the free stroke from the current point to `v`. `null`
 * when there is none — the pen cannot jump, and cannot go over a stroke twice.
 */
export function step(edges: NodeGraphEdge[], state: TraceState, v: string): TraceState | null {
  if (state.path.length === 0) return { path: [v], used: [] };
  const here = state.path[state.path.length - 1];
  const stroke = freeStroke(edges, state.used, here, v);
  if (stroke === undefined) return null;
  return { path: [...state.path, v], used: [...state.used, stroke] };
}

/** The tracing with its last stroke undone, or with the pen lifted if none was drawn. */
export function undo(state: TraceState): TraceState {
  if (state.used.length === 0) return EMPTY_TRACE;
  return { path: state.path.slice(0, -1), used: state.used.slice(0, -1) };
}

/** How many strokes are still to draw. */
export function remaining(edges: NodeGraphEdge[], state: TraceState): number {
  return edges.length - state.used.length;
}

export function status(edges: NodeGraphEdge[], state: TraceState): TraceStatus {
  if (state.path.length === 0) return 'empty';
  if (state.used.length === edges.length) return 'done';
  const here = state.path[state.path.length - 1];
  const taken = new Set(state.used);
  const canGoOn = edges.some(
    ([a, b], k) => !taken.has(k) && (String(a) === here || String(b) === here),
  );
  return canGoOn ? 'drawing' : 'stuck';
}

/**
 * A way to draw every stroke once without lifting the pen, as the points to
 * press in order, or `null` when there is none: a figure with more than two
 * odd points, or in more than one piece. It starts at the first odd point in
 * `order` — the first point, when none is odd — and walks the strokes with
 * Hierholzer's method: go on while the point has a free stroke, back up when
 * it has none, and splice in the loops left behind. Parallel strokes count
 * apart (#356).
 */
export function solve(edges: NodeGraphEdge[], order: string[]): string[] | null {
  const strokesAt = new Map<string, number[]>();
  edges.forEach(([a, b], k) => {
    for (const v of [String(a), String(b)]) strokesAt.set(v, [...(strokesAt.get(v) ?? []), k]);
  });
  if (strokesAt.size === 0) return null;
  const named = order.map(String);
  const points = [
    ...named.filter((v) => strokesAt.has(v)),
    ...[...strokesAt.keys()].filter((v) => !named.includes(v)),
  ];
  const odd = points.filter((v) => strokesAt.get(v)!.length % 2 === 1);
  if (odd.length !== 0 && odd.length !== 2) return null;

  const drawn = new Set<number>();
  const pending = [odd[0] ?? points[0]];
  const tour: string[] = [];
  while (pending.length > 0) {
    const v = pending[pending.length - 1];
    const free = strokesAt.get(v)!.find((k) => !drawn.has(k));
    if (free === undefined) {
      tour.push(pending.pop()!);
    } else {
      drawn.add(free);
      const [a, b] = edges[free];
      pending.push(String(a) === v ? String(b) : String(a));
    }
  }
  return drawn.size === edges.length ? tour.reverse() : null;
}

/**
 * Up to `count` ways of trying to draw a figure that has no solution, as the
 * points to press in order: from each of the first points of `order` that
 * have a stroke, the pen keeps taking the first free stroke at the point it is
 * on, and stops where none is left. Every attempt ends stuck with strokes
 * still to draw, because the figure has no tracing (#356).
 */
export function attempts(edges: NodeGraphEdge[], order: string[], count: number): string[][] {
  const ends = new Set(edges.flatMap(([a, b]) => [String(a), String(b)]));
  const starts = order
    .map(String)
    .filter((v) => ends.has(v))
    .slice(0, count);
  return starts.map((start) => {
    let state: TraceState = { path: [start], used: [] };
    for (;;) {
      const here = state.path[state.path.length - 1];
      const taken = new Set(state.used);
      const k = edges.findIndex(
        ([a, b], i) => !taken.has(i) && (String(a) === here || String(b) === here),
      );
      if (k === -1) return state.path;
      const [a, b] = edges[k];
      const next = String(a) === here ? String(b) : String(a);
      state = { path: [...state.path, next], used: [...state.used, k] };
    }
  });
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
 * first spot along it that is at least `gap` from every number written
 * before and `clear` from every point's centre. When the stroke has no such
 * spot — where several strokes cross — the number steps `side` off the
 * stroke, beside it. Failing even that, it takes the spot off the points
 * that stands furthest from the numbers already written.
 */
export function stepMarks(
  { edges, at }: Pick<NodeGraphLayout, 'edges' | 'at'>,
  trace: TraceState,
  { gap, clear, side }: { gap: number; clear: number; side: number },
): StepMark[] {
  const marks: StepMark[] = [];
  const points = [...at.values()];
  const nearest = (p: { x: number; y: number }, qs: { x: number; y: number }[]) =>
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
    marks.push({
      stroke: k,
      step: i + 1,
      x: Math.round(free.x * 10) / 10,
      y: Math.round(free.y * 10) / 10,
    });
  });
  return marks;
}
