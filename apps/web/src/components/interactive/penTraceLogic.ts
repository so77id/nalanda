import type { NodeGraphEdge } from '../nodeGraphLayout';

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
