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

/** What the recursive walk does in a frame; each names the lines it lights. */
export type DfsEvent = 'mark' | 'look' | 'prev' | 'recurse' | 'return';

/**
 * What an iterative walk does in a frame. `markStart` belongs to the version
 * that marks on push only; `skip` to the one that marks on pop only.
 */
export type StackDfsEvent =
  'markStart' | 'pushStart' | 'pop' | 'skip' | 'mark' | 'look' | 'prev' | 'push' | 'end';

export type WalkEvent = DfsEvent | StackDfsEvent;

/** Where an iterative walk marks a vertex: as it pops it, or as it pushes it. */
export type MarkOn = 'pop' | 'push';

export interface WalkFrame {
  event: WalkEvent;
  /**
   * Recursive: the vertex whose call is running. Iterative: the vertex last
   * popped, whose neighbours the loop is reading; null before the first pop
   * and once the stack is empty.
   */
  v: number | null;
  /** The neighbour of `v` the frame is about. */
  w: number | null;
  /** On `look`: whether `w` was already marked. */
  seen: boolean | null;
  /**
   * On `look`, marking on push: `w` is marked and skipped, but the walk has
   * not been to it — «marked» has come to mean «seen», not «visited».
   */
  unvisited: boolean;
  marked: boolean[];
  /** The vertex each one was reached from; −1 while it has none. */
  prev: number[];
  /**
   * Recursive: the calls in progress, the first call at the bottom (Teseo's
   * thread). Iterative: the stack the loop keeps, its bottom first.
   */
  stack: number[];
  /** Recursive: the vertices whose call has returned, in that order. */
  done: number[];
  /** The vertices in the order the walk reached them. */
  order: number[];
  /** The cell of `marked` or `prev` this frame wrote, if it wrote one. */
  wrote: { array: 'marked' | 'prev'; index: number } | null;
  /** The frame's narration, in Spanish. */
  text: string;
}

type FrameFields = Pick<WalkFrame, 'event' | 'v' | 'w' | 'text'> &
  Partial<Pick<WalkFrame, 'seen' | 'unvisited' | 'wrote'>>;

/** The walk's state, snapshotted into a frame after every step. */
class Recorder {
  readonly marked: boolean[];
  readonly prev: number[];
  readonly stack: number[] = [];
  readonly done: number[] = [];
  readonly order: number[] = [];
  readonly frames: WalkFrame[] = [];

  constructor(V: number) {
    this.marked = Array.from({ length: V }, () => false);
    this.prev = Array.from({ length: V }, () => -1);
  }

  record(f: FrameFields) {
    this.frames.push({
      seen: null,
      unvisited: false,
      wrote: null,
      ...f,
      marked: [...this.marked],
      prev: [...this.prev],
      stack: [...this.stack],
      done: [...this.done],
      order: [...this.order],
    });
  }
}

function lookText(v: number, w: number, seen: boolean): string {
  return seen
    ? `Mira el vecino ${w} de ${v}: ya está marcado, lo salta.`
    : `Mira el vecino ${w} de ${v}: no está marcado.`;
}

/**
 * Depth-first search, recursive, exactly as the listing reads:
 *
 * ```java
 * private void dfs(Graph g, int v) {
 *     marked[v] = true;
 *     for (int w : g.adj(v)) {
 *         if (!marked[w]) {
 *             prev[w] = v;
 *             dfs(g, w);
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
  const r = new Recorder(V);
  const { marked, prev, stack, done, order } = r;

  const dfs = (v: number) => {
    stack.push(v);
    marked[v] = true;
    order.push(v);
    r.record({
      event: 'mark',
      v,
      w: null,
      wrote: { array: 'marked', index: v },
      text: `dfs(${v}) marca ${v}.`,
    });
    for (const w of adj[v]) {
      const seen = marked[w];
      r.record({ event: 'look', v, w, seen, text: lookText(v, w, seen) });
      if (!seen) {
        prev[w] = v;
        r.record({
          event: 'prev',
          v,
          w,
          wrote: { array: 'prev', index: w },
          text: `prev[${w}] = ${v}: a ${w} se llega desde ${v}.`,
        });
        r.record({ event: 'recurse', v, w, text: `Llama a dfs(${w}).` });
        dfs(w);
      }
    }
    done.push(v);
    const caller = stack.length > 1 ? stack[stack.length - 2] : null;
    r.record({
      event: 'return',
      v,
      w: null,
      text:
        caller === null
          ? `dfs(${v}) termina: no queda nada por recorrer.`
          : `dfs(${v}) termina y vuelve a dfs(${caller}).`,
    });
    stack.pop();
  };

  dfs(start);
  return r.frames;
}

/**
 * Depth-first search with a stack of its own, as the listing reads when it
 * marks on pop (`markOn = 'pop'`):
 *
 * ```java
 * Stack<Integer> stack = new Stack<>();
 * stack.push(s);
 * while (!stack.empty()) {
 *     int v = stack.pop();
 *     if (marked[v]) {
 *         continue;
 *     }
 *     marked[v] = true;
 *     for (int w : g.adj(v)) {
 *         if (!marked[w]) {
 *             prev[w] = v;
 *             stack.push(w);
 *         }
 *     }
 * }
 * ```
 *
 * and as the tempting version reads, which marks on push (`markOn = 'push'`):
 * `marked[s] = true` before the first push, no `if (marked[v]) continue`, and
 * `marked[w] = true` before `prev[w] = v`. That one never pops a vertex twice,
 * but it skips neighbours it has marked and not yet walked to, so its order is
 * not depth-first (the fan with a chord walks 0, 3, 2, 1).
 *
 * One frame per assignment (`markStart`, `pushStart`, `pop`, `mark`, `prev`,
 * `push`), per neighbour looked at (`look`), per vertex dropped (`skip`), and
 * one when the stack runs out (`end`).
 */
export function traceDfsStack(
  adj: readonly (readonly number[])[],
  start: number,
  markOn: MarkOn,
): WalkFrame[] {
  const V = adj.length;
  if (!isVertex(V, start)) {
    throw new RangeError(`start ${start} is not a vertex of 0..${V - 1}`);
  }
  const r = new Recorder(V);
  const { marked, prev, stack, order } = r;

  if (markOn === 'push') {
    marked[start] = true;
    r.record({
      event: 'markStart',
      v: null,
      w: null,
      wrote: { array: 'marked', index: start },
      text: `Marca el origen ${start}.`,
    });
  }
  stack.push(start);
  r.record({
    event: 'pushStart',
    v: null,
    w: null,
    text: markOn === 'push' ? `Apila ${start}.` : `Apila el origen ${start}.`,
  });
  while (stack.length > 0) {
    const v = stack.pop()!;
    if (markOn === 'push') order.push(v);
    r.record({
      event: 'pop',
      v,
      w: null,
      text: markOn === 'push' ? `Saca ${v} de la pila y sigue desde ahí.` : `Saca ${v} de la pila.`,
    });
    if (markOn === 'pop') {
      if (marked[v]) {
        r.record({ event: 'skip', v, w: null, text: `${v} ya está marcado: lo descarta.` });
        continue;
      }
      marked[v] = true;
      order.push(v);
      r.record({
        event: 'mark',
        v,
        w: null,
        wrote: { array: 'marked', index: v },
        text: `Marca ${v}.`,
      });
    }
    for (const w of adj[v]) {
      const seen = marked[w];
      const unvisited = seen && !order.includes(w);
      r.record({
        event: 'look',
        v,
        w,
        seen,
        unvisited,
        text: unvisited
          ? `Mira el vecino ${w} de ${v}: está marcado y lo salta, pero el recorrido todavía no pasa por ${w}.`
          : lookText(v, w, seen),
      });
      if (seen) continue;
      if (markOn === 'push') {
        marked[w] = true;
        r.record({
          event: 'mark',
          v,
          w,
          wrote: { array: 'marked', index: w },
          text: `Marca ${w} al apilarlo.`,
        });
      }
      const before = prev[w];
      prev[w] = v;
      r.record({
        event: 'prev',
        v,
        w,
        wrote: { array: 'prev', index: w },
        text:
          before < 0
            ? `prev[${w}] = ${v}: a ${w} se llega desde ${v}.`
            : `prev[${w}] = ${v}: ahora a ${w} se llega desde ${v}, no desde ${before}.`,
      });
      stack.push(w);
      r.record({ event: 'push', v, w, text: `Apila ${w}.` });
    }
  }
  r.record({
    event: 'end',
    v: null,
    w: null,
    text: 'La pila quedó vacía: no queda nada por recorrer.',
  });
  return r.frames;
}

function isVertex(V: number, v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < V;
}
