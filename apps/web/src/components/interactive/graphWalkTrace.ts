/**
 * The pure half of `<GraphWalk>`: a graph and a start vertex in, the frames of
 * a walk out — no DOM, no React (the split `apps/web/CLAUDE.md` §2 asks for,
 * as `sequenceStepperTrace.ts` does for the stepper). Every frame is a
 * snapshot: what the walk holds after that one step.
 */

export type GraphWalkEdge = readonly [number, number];

/**
 * The adjacency lists a Java `AdjListGraph` builds from these edges, in the
 * order `addEdge` appends them (#363): `v`'s list gets `w` and, without
 * direction, `w`'s list gets `v`. The walk visits neighbours in this order, so
 * it is the one the course's code produces.
 */
export function adjacencyOf(
  V: number,
  edges: readonly GraphWalkEdge[],
  directed = false,
): number[][] {
  const adj: number[][] = Array.from({ length: V }, () => []);
  for (const [v, w] of edges) {
    if (!isVertex(V, v) || !isVertex(V, w)) {
      throw new RangeError(`edge ${v}-${w} names a vertex outside 0..${V - 1}`);
    }
    adj[v].push(w);
    if (!directed) adj[w].push(v);
  }
  return adj;
}

/** What the walk does in a frame; each names the line of the listing it lights. */
export type DfsEvent = 'mark' | 'look' | 'prev' | 'recurse' | 'return';

export interface WalkFrame {
  event: DfsEvent;
  /** The vertex whose call is running. */
  v: number;
  /** The neighbour of `v` the frame is about (`look`, `prev`, `recurse`). */
  w: number | null;
  /** On `look`: whether `w` was already marked. */
  seen: boolean | null;
  marked: boolean[];
  /** The vertex each one was reached from; −1 while it has none. */
  prev: number[];
  /** The calls in progress, the first call at the bottom: Teseo's thread. */
  stack: number[];
  /** The vertices whose call has returned, in the order they returned. */
  done: number[];
  /** The vertices in the order they were marked. */
  order: number[];
  /** The frame's narration, in Spanish. */
  text: string;
}

/**
 * Depth-first search, recursive, exactly as the listing reads:
 *
 * ```java
 * static void dfs(Graph g, int v, boolean[] marked, int[] prev) {
 *     marked[v] = true;
 *     for (int w : g.adj(v)) {
 *         if (!marked[w]) {
 *             prev[w] = v;
 *             dfs(g, w, marked, prev);
 *         }
 *     }
 * }
 * ```
 *
 * One frame per assignment (`mark`, `prev`), one per neighbour looked at
 * (`look`, the `for` and its `if`), one per call made (`recurse`) and one per
 * call that ends (`return`).
 */
export function traceDfs(adj: readonly (readonly number[])[], start: number): WalkFrame[] {
  const V = adj.length;
  if (!isVertex(V, start)) {
    throw new RangeError(`start ${start} is not a vertex of 0..${V - 1}`);
  }
  const marked: boolean[] = Array.from({ length: V }, () => false);
  const prev: number[] = Array.from({ length: V }, () => -1);
  const stack: number[] = [];
  const done: number[] = [];
  const order: number[] = [];
  const frames: WalkFrame[] = [];

  const push = (
    event: DfsEvent,
    v: number,
    w: number | null,
    seen: boolean | null,
    text: string,
  ) => {
    frames.push({
      event,
      v,
      w,
      seen,
      marked: [...marked],
      prev: [...prev],
      stack: [...stack],
      done: [...done],
      order: [...order],
      text,
    });
  };

  const dfs = (v: number) => {
    stack.push(v);
    marked[v] = true;
    order.push(v);
    push('mark', v, null, null, `dfs(${v}) marca ${v}.`);
    for (const w of adj[v]) {
      const seen = marked[w];
      push(
        'look',
        v,
        w,
        seen,
        seen
          ? `Mira el vecino ${w} de ${v}: ya está marcado, lo salta.`
          : `Mira el vecino ${w} de ${v}: no está marcado.`,
      );
      if (!seen) {
        prev[w] = v;
        push('prev', v, w, null, `prev[${w}] = ${v}: a ${w} se llega desde ${v}.`);
        push('recurse', v, w, null, `Llama a dfs(${w}).`);
        dfs(w);
      }
    }
    done.push(v);
    const caller = stack.length > 1 ? stack[stack.length - 2] : null;
    push(
      'return',
      v,
      null,
      null,
      caller === null
        ? `dfs(${v}) termina: no queda nada por recorrer.`
        : `dfs(${v}) termina y vuelve a dfs(${caller}).`,
    );
    stack.pop();
  };

  dfs(start);
  return frames;
}

function isVertex(V: number, v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < V;
}
