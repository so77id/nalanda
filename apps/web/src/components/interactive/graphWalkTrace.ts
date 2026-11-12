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

/**
 * What a breadth-first walk does in a frame. `distStart`, `dist` and `prev`
 * belong to the search that marks on enqueue; `skip` to the tempting one that
 * marks on dequeue.
 */
export type BfsEvent =
  | 'markStart'
  | 'distStart'
  | 'enqueueStart'
  | 'dequeue'
  | 'skip'
  | 'mark'
  | 'look'
  | 'dist'
  | 'prev'
  | 'enqueue'
  | 'end';

/** What Kahn's walk does in a frame; each names the lines it lights. */
export type KahnEvent =
  'inDegrees' | 'check' | 'enqueueStart' | 'dequeue' | 'append' | 'lower' | 'enqueue' | 'end';

export type WalkEvent = DfsEvent | StackDfsEvent | BfsEvent | KahnEvent;

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
   * Breadth-first: the queue, its front first.
   */
  stack: number[];
  /** Breadth-first: each vertex's distance from the start, −1 unreached. */
  dist: number[] | null;
  /** Kahn: each vertex's arcs still coming in; null before they are counted. */
  inDegree: number[] | null;
  /**
   * Breadth-first, marking on dequeue: the frame enqueued `w` while it was
   * already in the queue — the duplicate marking on enqueue avoids.
   */
  twice: boolean;
  /** Recursive: the vertices whose call has returned, in that order. */
  done: number[];
  /** The vertices in the order the walk reached them. */
  order: number[];
  /** The cell of an array this frame wrote, if it wrote one. */
  wrote: { array: 'marked' | 'dist' | 'prev' | 'inDegree' | 'order'; index: number } | null;
  /**
   * On `look` over a grid: the cell looked at, `[row, col]`, in the grid or
   * off it (`w` is null off it). Null over a graph.
   */
  cell: readonly [number, number] | null;
  /** On `look` over a grid: a wall or off the grid, so `free` is false. */
  blocked: boolean;
  /** The frame's narration, in Spanish. */
  text: string;
}

type FrameFields = Pick<WalkFrame, 'event' | 'v' | 'w' | 'text'> &
  Partial<Pick<WalkFrame, 'seen' | 'unvisited' | 'wrote' | 'cell' | 'blocked' | 'twice'>>;

/** The walk's state, snapshotted into a frame after every step. */
class Recorder {
  readonly marked: boolean[];
  readonly prev: number[];
  /** Kept only by a breadth-first walk; null in the others. */
  readonly dist: number[] | null;
  /** Kept only by Kahn's walk, once counted. */
  inDegree: number[] | null = null;
  readonly stack: number[] = [];
  readonly done: number[] = [];
  readonly order: number[] = [];
  readonly frames: WalkFrame[] = [];

  constructor(V: number, withDist = false) {
    this.marked = Array.from({ length: V }, () => false);
    this.prev = Array.from({ length: V }, () => -1);
    this.dist = withDist ? Array.from({ length: V }, () => -1) : null;
  }

  record(f: FrameFields) {
    this.frames.push({
      seen: null,
      unvisited: false,
      wrote: null,
      cell: null,
      blocked: false,
      twice: false,
      ...f,
      marked: [...this.marked],
      prev: [...this.prev],
      dist: this.dist === null ? null : [...this.dist],
      inDegree: this.inDegree === null ? null : [...this.inDegree],
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

/** One place the recursive walk looks from `v`: a neighbour, or a cell of a grid. */
interface Probe {
  /** The vertex looked at; null off the grid. */
  w: number | null;
  /** A wall, or off the grid: not a vertex to walk to, whatever `marked` says. */
  blocked: boolean;
  cell: readonly [number, number] | null;
  /** The frame's narration, given whether `w` is marked. */
  text: (seen: boolean) => string;
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
 * call that ends (`return`). With `paths` false the search keeps only
 * `marked`: no `prev` is written and no `prev` frame is recorded.
 */
export function traceDfs(
  adj: readonly (readonly number[])[],
  start: number,
  paths = true,
): WalkFrame[] {
  const V = adj.length;
  if (!isVertex(V, start)) {
    throw new RangeError(`start ${start} is not a vertex of 0..${V - 1}`);
  }
  return walkRecursive(
    V,
    start,
    (v) =>
      adj[v].map((w) => ({
        w,
        blocked: false,
        cell: null,
        text: (seen) => lookText(v, w, seen),
      })),
    (v) => `dfs(${v}) marca ${v}.`,
    paths,
  );
}

/** Up, down, left, right: `DR4` and `DC4`, in the order class 2 wrote them. */
const GRID_STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const GRID_DIRECTIONS = ['arriba', 'abajo', 'a la izquierda', 'a la derecha'];

/**
 * Depth-first search over the implicit graph of a maze: `grid` is its rows,
 * `.` a free cell and `#` a wall; the cell in row r and column c is the
 * vertex r · C + c, and its neighbours are computed, never stored, exactly as
 * the listing reads:
 *
 * ```java
 * private void dfs(int v) {
 *     marked[v] = true;
 *     for (int k = 0; k < 4; k++) {
 *         int r = v / cols + DR4[k];
 *         int c = v % cols + DC4[k];
 *         int w = r * cols + c;
 *         if (free(r, c) && !marked[w]) {
 *             prev[w] = v;
 *             dfs(w);
 *         }
 *     }
 * }
 * ```
 *
 * The frames are `traceDfs`'s, with one `look` per direction — a wall or the
 * border included, since the loop asks `free` about all four.
 */
export function traceGridDfs(grid: readonly string[], start: number): WalkFrame[] {
  const R = grid.length;
  const C = R > 0 ? grid[0].length : 0;
  if (C === 0 || grid.some((row) => row.length !== C)) {
    throw new RangeError('grid needs rows, all of the same length');
  }
  if (grid.some((row) => /[^.#]/.test(row))) {
    throw new RangeError("grid holds only '.' and '#'");
  }
  const inside = (r: number, c: number) => r >= 0 && r < R && c >= 0 && c < C;
  const free = (r: number, c: number) => inside(r, c) && grid[r][c] === '.';
  if (!isVertex(R * C, start) || !free(Math.floor(start / C), start % C)) {
    throw new RangeError(`start ${start} is not a free cell of the grid`);
  }
  return walkRecursive(
    R * C,
    start,
    (v) =>
      GRID_STEPS.map(([dr, dc], k): Probe => {
        const r = Math.floor(v / C) + dr;
        const c = (v % C) + dc;
        const w = inside(r, c) ? r * C + c : null;
        const where = `Mira ${GRID_DIRECTIONS[k]} de ${v}:`;
        return {
          w,
          blocked: !free(r, c),
          cell: [r, c],
          text: (seen) =>
            w === null
              ? `${where} ${position(r, c)} está fuera de la grilla, y free es false.`
              : !free(r, c)
                ? `${where} ${position(r, c)} es muro, y free es false.`
                : seen
                  ? `${where} ${w} está libre, pero ya está marcada; la salta.`
                  : `${where} ${w} está libre y sin marcar.`,
        };
      }),
    (v) => `dfs(${v}) marca la celda ${v}, en ${position(Math.floor(v / C), v % C)}.`,
  );
}

/** `(r, c)`, a negative written with a true minus sign. */
function position(r: number, c: number): string {
  const n = (x: number) => (x < 0 ? `−${-x}` : String(x));
  return `(${n(r)}, ${n(c)})`;
}

/** The recursive walk, over whatever `probesOf` says `v` looks at. */
function walkRecursive(
  V: number,
  start: number,
  probesOf: (v: number) => Probe[],
  markText: (v: number) => string,
  paths = true,
): WalkFrame[] {
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
      text: markText(v),
    });
    for (const probe of probesOf(v)) {
      const { w, blocked, cell } = probe;
      const seen = blocked || w === null ? null : marked[w];
      r.record({ event: 'look', v, w, seen, blocked, cell, text: probe.text(seen === true) });
      if (seen !== false || w === null) continue;
      if (paths) {
        prev[w] = v;
        r.record({
          event: 'prev',
          v,
          w,
          wrote: { array: 'prev', index: w },
          text: `prev[${w}] = ${v}: a ${w} se llega desde ${v}.`,
        });
      }
      r.record({ event: 'recurse', v, w, text: `Llama a dfs(${w}).` });
      dfs(w);
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
  paths = true,
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
      if (paths) {
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
      }
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

/**
 * Breadth-first search, as the listing reads when it marks on enqueue
 * (`markOn = 'push'`):
 *
 * ```java
 * Queue<Integer> queue = new ArrayDeque<>();
 * marked[s] = true;
 * dist[s] = 0;
 * queue.add(s);
 * while (!queue.isEmpty()) {
 *     int v = queue.remove();
 *     for (int w : g.adj(v)) {
 *         if (!marked[w]) {
 *             marked[w] = true;
 *             dist[w] = dist[v] + 1;
 *             prev[w] = v;
 *             queue.add(w);
 *         }
 *     }
 * }
 * ```
 *
 * and as the tempting version reads, which marks on dequeue (`markOn = 'pop'`)
 * and keeps neither `dist` nor `prev`: `queue.add(s)`, then `remove`, `if
 * (marked[v]) continue`, `marked[v] = true` and `queue.add(w)` for every
 * unmarked neighbour. It ends, but a vertex reached from two vertices of one
 * layer enters the queue twice (a diamond shows it).
 *
 * One frame per assignment (`markStart`, `distStart`, `enqueueStart`,
 * `dequeue`, `mark`, `dist`, `prev`, `enqueue`), per neighbour looked at
 * (`look`), per vertex dropped (`skip`), and one when the queue runs out
 * (`end`).
 */
export function traceBfs(
  adj: readonly (readonly number[])[],
  start: number,
  markOn: MarkOn,
): WalkFrame[] {
  const V = adj.length;
  if (!isVertex(V, start)) {
    throw new RangeError(`start ${start} is not a vertex of 0..${V - 1}`);
  }
  const onPush = markOn === 'push';
  const r = new Recorder(V, onPush);
  const { marked, prev, order } = r;
  const dist = r.dist;
  const queue = r.stack;

  if (onPush && dist !== null) {
    marked[start] = true;
    r.record({
      event: 'markStart',
      v: null,
      w: null,
      wrote: { array: 'marked', index: start },
      text: `Marca el origen ${start}.`,
    });
    dist[start] = 0;
    r.record({
      event: 'distStart',
      v: null,
      w: null,
      wrote: { array: 'dist', index: start },
      text: `dist[${start}] = 0: el origen está a distancia 0 de sí mismo.`,
    });
  }
  queue.push(start);
  r.record({ event: 'enqueueStart', v: null, w: null, text: `Encola el origen ${start}.` });
  while (queue.length > 0) {
    const v = queue.shift()!;
    if (onPush) order.push(v);
    r.record({ event: 'dequeue', v, w: null, text: `Saca ${v} del frente de la cola.` });
    if (!onPush) {
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
      const queued = !seen && queue.includes(w);
      r.record({
        event: 'look',
        v,
        w,
        seen,
        text: seen
          ? `Mira el vecino ${w} de ${v}: ya está marcado, lo salta.`
          : queued
            ? `Mira el vecino ${w} de ${v}: no está marcado, aunque ya está en la cola.`
            : `Mira el vecino ${w} de ${v}: no está marcado.`,
      });
      if (seen) continue;
      if (onPush && dist !== null) {
        marked[w] = true;
        r.record({
          event: 'mark',
          v,
          w,
          wrote: { array: 'marked', index: w },
          text: `Marca ${w} al encolarlo.`,
        });
        dist[w] = dist[v] + 1;
        r.record({
          event: 'dist',
          v,
          w,
          wrote: { array: 'dist', index: w },
          text: `dist[${w}] = dist[${v}] + 1 = ${dist[w]}.`,
        });
        prev[w] = v;
        r.record({
          event: 'prev',
          v,
          w,
          wrote: { array: 'prev', index: w },
          text: `prev[${w}] = ${v}: a ${w} se llega desde ${v}.`,
        });
      }
      queue.push(w);
      r.record({
        event: 'enqueue',
        v,
        w,
        twice: queued,
        text: queued ? `Encola ${w} por segunda vez: ya estaba en la cola.` : `Encola ${w}.`,
      });
    }
  }
  r.record({
    event: 'end',
    v: null,
    w: null,
    text: 'La cola quedó vacía: no queda nada por recorrer.',
  });
  return r.frames;
}

/**
 * Kahn's topological order over a directed graph, exactly as the listing
 * reads:
 *
 * ```java
 * int[] inDegree = Graphs.inDegrees(g);
 * Queue<Integer> sources = new ArrayDeque<>();
 * for (int v = 0; v < g.V(); v++) {
 *     if (inDegree[v] == 0) {
 *         sources.add(v);
 *     }
 * }
 * while (!sources.isEmpty()) {
 *     int v = sources.remove();
 *     order.add(v);
 *     for (int w : g.adj(v)) {
 *         inDegree[w]--;
 *         if (inDegree[w] == 0) {
 *             sources.add(w);
 *         }
 *     }
 * }
 * ```
 *
 * One frame for the in-degrees, one per vertex the first loop asks about
 * (`check`, or `enqueueStart` for a source), one per assignment in the second
 * (`dequeue`, `append`, `lower`, `enqueue` — the `if` folded into `lower` or
 * `enqueue`), and one when the queue runs out (`end`), which says whether
 * every vertex made it onto the line or a cycle is left over. `order` holds
 * the line; `stack` the queue of sources, its front first.
 */
export function traceKahn(adj: readonly (readonly number[])[]): WalkFrame[] {
  const V = adj.length;
  const r = new Recorder(V);
  const { order } = r;
  const sources = r.stack;
  const inDegree = Array.from({ length: V }, () => 0);
  for (const list of adj) for (const w of list) inDegree[w]++;
  r.inDegree = inDegree;
  r.record({
    event: 'inDegrees',
    v: null,
    w: null,
    text: 'inDegrees(g) cuenta cuántos arcos llegan a cada vértice.',
  });
  for (let v = 0; v < V; v++) {
    if (inDegree[v] === 0) {
      sources.push(v);
      r.record({
        event: 'enqueueStart',
        v: null,
        w: v,
        text: `inDegree[${v}] = 0: ${v} es fuente y entra a la cola.`,
      });
    } else {
      r.record({
        event: 'check',
        v: null,
        w: v,
        text: `inDegree[${v}] = ${inDegree[v]}: ${v} no es fuente.`,
      });
    }
  }
  while (sources.length > 0) {
    const v = sources.shift()!;
    r.record({ event: 'dequeue', v, w: null, text: `Saca la fuente ${v} de la cola.` });
    order.push(v);
    r.record({
      event: 'append',
      v,
      w: null,
      wrote: { array: 'order', index: order.length - 1 },
      text: `order.add(${v}): ${v} es el siguiente en la línea.`,
    });
    for (const w of adj[v]) {
      inDegree[w]--;
      r.record({
        event: 'lower',
        v,
        w,
        wrote: { array: 'inDegree', index: w },
        text:
          inDegree[w] === 0
            ? `El arco ${v} → ${w} deja de contar: inDegree[${w}] baja a 0.`
            : `El arco ${v} → ${w} deja de contar: inDegree[${w}] baja a ${inDegree[w]}.`,
      });
      if (inDegree[w] === 0) {
        sources.push(w);
        r.record({
          event: 'enqueue',
          v,
          w,
          text: `${w} quedó sin arcos de entrada: es fuente y entra a la cola.`,
        });
      }
    }
  }
  r.record({
    event: 'end',
    v: null,
    w: null,
    text:
      order.length === V
        ? `La cola quedó vacía con los ${V} vértices en la línea: es un orden topológico.`
        : `La cola quedó vacía con ${order.length} de ${V} vértices en la línea: los que faltan forman un ciclo.`,
  });
  return r.frames;
}

function isVertex(V: number, v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < V;
}
