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
