import { describe, expect, it } from 'vitest';
import {
  adjacencyOf,
  traceBfs,
  traceDfs,
  traceDfsStack,
  traceGridDfs,
  traceKahn,
} from './graphWalkTrace';

describe('adjacencyOf', () => {
  it('appends both ends of an undirected edge, in the order the edges arrive (AdjListGraph.addEdge)', () => {
    expect(
      adjacencyOf(3, [
        [0, 1],
        [0, 2],
        [1, 2],
      ]),
    ).toEqual([
      [1, 2],
      [0, 2],
      [0, 1],
    ]);
  });

  it('appends only the head of an arc when the graph is directed', () => {
    expect(
      adjacencyOf(
        3,
        [
          [0, 1],
          [2, 0],
        ],
        true,
      ),
    ).toEqual([[1], [], [0]]);
  });

  it('refuses an edge whose end is not a vertex', () => {
    expect(() => adjacencyOf(2, [[0, 2]])).toThrow(RangeError);
  });
});

describe('traceDfs', () => {
  it('walks a single edge as mark, look, prev, recurse, mark, look back, return, return', () => {
    const frames = traceDfs(adjacencyOf(2, [[0, 1]]), 0);
    expect(frames.map((f) => [f.event, f.v, f.w])).toEqual([
      ['mark', 0, null],
      ['look', 0, 1],
      ['prev', 0, 1],
      ['recurse', 0, 1],
      ['mark', 1, null],
      ['look', 1, 0],
      ['return', 1, null],
      ['return', 0, null],
    ]);
  });

  it('says on each look whether the neighbour was already marked', () => {
    const frames = traceDfs(adjacencyOf(2, [[0, 1]]), 0);
    const looks = frames.filter((f) => f.event === 'look');
    expect(looks.map((f) => f.seen)).toEqual([false, true]);
  });

  it('keeps the calls in progress as a stack whose top is the running call', () => {
    const frames = traceDfs(
      adjacencyOf(3, [
        [0, 1],
        [1, 2],
      ]),
      0,
    );
    for (const f of frames) expect(f.stack[f.stack.length - 1]).toBe(f.v);
    const deepest = Math.max(...frames.map((f) => f.stack.length));
    expect(deepest).toBe(3);
  });

  it('ends with every reachable vertex marked, prev pointing back along the walk, and no call left', () => {
    const frames = traceDfs(
      adjacencyOf(4, [
        [0, 1],
        [0, 2],
        [1, 2],
      ]),
      0,
    );
    const last = frames[frames.length - 1];
    expect(last.marked).toEqual([true, true, true, false]);
    expect(last.prev).toEqual([-1, 0, 1, -1]);
    expect(last.order).toEqual([0, 1, 2]);
    expect(last.done).toEqual([2, 1, 0]);
    expect(last.event).toBe('return');
    expect(last.stack).toEqual([0]);
  });

  it('never reaches a vertex with no path from the start', () => {
    const frames = traceDfs(adjacencyOf(3, [[0, 1]]), 0);
    expect(frames.some((f) => f.v === 2 || f.w === 2)).toBe(false);
    expect(frames[frames.length - 1].marked[2]).toBe(false);
  });

  it('snapshots each frame, so a later mark does not rewrite an earlier one', () => {
    const frames = traceDfs(adjacencyOf(2, [[0, 1]]), 0);
    expect(frames[0].marked).toEqual([true, false]);
    expect(frames[frames.length - 1].marked).toEqual([true, true]);
  });

  it('narrates every frame in Spanish, naming the vertices it is about', () => {
    const frames = traceDfs(adjacencyOf(2, [[0, 1]]), 0);
    expect(frames[0].text).toBe('dfs(0) marca 0.');
    expect(frames[1].text).toBe('Mira el vecino 1 de 0: no está marcado.');
    expect(frames[2].text).toBe('prev[1] = 0: a 1 se llega desde 0.');
    expect(frames[3].text).toBe('Llama a dfs(1).');
    expect(frames[5].text).toBe('Mira el vecino 0 de 1: ya está marcado, lo salta.');
    expect(frames[6].text).toBe('dfs(1) termina y vuelve a dfs(0).');
    expect(frames[7].text).toBe('dfs(0) termina: marcó todo lo que se alcanza desde 0.');
  });

  it('refuses a start that is not a vertex', () => {
    expect(() => traceDfs(adjacencyOf(2, [[0, 1]]), 5)).toThrow(RangeError);
  });
});

// The square 0-1-2-3-0 (adj: 0 [1, 3], 1 [0, 2], 2 [1, 3], 3 [2, 0]) and the
// fan 0-1, 0-2, 0-3 with the chord 1-3: the smallest graph where marking on
// push walks an order no depth-first walk takes (#357 S5, by brute force).
const SQUARE = (): number[][] =>
  adjacencyOf(4, [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]);
const FAN = (): number[][] =>
  adjacencyOf(4, [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 3],
  ]);

describe('traceDfsStack, marking on pop (the iterative depth-first search)', () => {
  it('pushes the start, then pops, marks, looks, sets prev and pushes, one step each', () => {
    const frames = traceDfsStack(adjacencyOf(2, [[0, 1]]), 0, 'pop');
    expect(frames.map((f) => [f.event, f.v, f.w])).toEqual([
      ['pushStart', null, null],
      ['pop', 0, null],
      ['mark', 0, null],
      ['look', 0, 1],
      ['prev', 0, 1],
      ['push', 0, 1],
      ['pop', 1, null],
      ['mark', 1, null],
      ['look', 1, 0],
      ['end', null, null],
    ]);
  });

  it('keeps the stack it pushes to, bottom first', () => {
    const frames = traceDfsStack(SQUARE(), 0, 'pop');
    const pushes = frames.filter((f) => f.event === 'push' || f.event === 'pushStart');
    expect(pushes.map((f) => f.stack)).toEqual([[0], [1], [1, 3], [1, 2], [1, 1]]);
    expect(frames[frames.length - 1].stack).toEqual([]);
  });

  it('visits the neighbours in the reverse of adj order, the stack turning them around', () => {
    const last = traceDfsStack(SQUARE(), 0, 'pop').at(-1)!;
    expect(last.order).toEqual([0, 3, 2, 1]);
    expect(traceDfs(SQUARE(), 0).at(-1)!.order).toEqual([0, 1, 2, 3]);
  });

  it('drops a vertex popped a second time, already marked', () => {
    const frames = traceDfsStack(SQUARE(), 0, 'pop');
    const skips = frames.filter((f) => f.event === 'skip');
    expect(skips.map((f) => f.v)).toEqual([1]);
    expect(skips[0].text).toBe('1 ya está marcado: lo descarta.');
  });

  it('rewrites prev when a vertex is pushed again, and says from where it is reached now', () => {
    const frames = traceDfsStack(SQUARE(), 0, 'pop');
    const prevOf1 = frames.filter((f) => f.event === 'prev' && f.w === 1);
    expect(prevOf1.map((f) => f.text)).toEqual([
      'prev[1] = 0: a 1 se llega desde 0.',
      'prev[1] = 2: ahora a 1 se llega desde 2, no desde 0.',
    ]);
    expect(frames.at(-1)!.prev).toEqual([-1, 2, 3, 0]);
  });

  it('records the cell each frame wrote, for the arrays to light', () => {
    const frames = traceDfsStack(adjacencyOf(2, [[0, 1]]), 0, 'pop');
    expect(frames.map((f) => f.wrote)).toEqual([
      null,
      null,
      { array: 'marked', index: 0 },
      null,
      { array: 'prev', index: 1 },
      null,
      null,
      { array: 'marked', index: 1 },
      null,
      null,
    ]);
  });

  it('narrates every frame in Spanish', () => {
    const frames = traceDfsStack(adjacencyOf(2, [[0, 1]]), 0, 'pop');
    expect(frames.map((f) => f.text)).toEqual([
      'Apila el origen 0.',
      'Saca 0 de la pila.',
      'Marca 0.',
      'Mira el vecino 1 de 0: no está marcado.',
      'prev[1] = 0: a 1 se llega desde 0.',
      'Apila 1.',
      'Saca 1 de la pila.',
      'Marca 1.',
      'Mira el vecino 0 de 1: ya está marcado, lo salta.',
      'La pila quedó vacía: marcó todo lo que se alcanza desde 0.',
    ]);
  });

  it('refuses a start that is not a vertex', () => {
    expect(() => traceDfsStack(adjacencyOf(2, [[0, 1]]), 2, 'pop')).toThrow(RangeError);
  });
});

describe('traceDfsStack, marking on push (the tempting version)', () => {
  it('marks the start before pushing it, and each neighbour as it pushes it', () => {
    const frames = traceDfsStack(adjacencyOf(2, [[0, 1]]), 0, 'push');
    expect(frames.map((f) => [f.event, f.v, f.w])).toEqual([
      ['markStart', null, null],
      ['pushStart', null, null],
      ['pop', 0, null],
      ['look', 0, 1],
      ['mark', 0, 1],
      ['prev', 0, 1],
      ['push', 0, 1],
      ['pop', 1, null],
      ['look', 1, 0],
      ['end', null, null],
    ]);
    expect(frames[0].wrote).toEqual({ array: 'marked', index: 0 });
    expect(frames[4].wrote).toEqual({ array: 'marked', index: 1 });
    expect(frames[4].text).toBe('Marca 1 al apilarlo.');
  });

  it('walks the fan as 0, 3, 2, 1: from 3 it jumps to 2, with no edge between them', () => {
    const last = traceDfsStack(FAN(), 0, 'push').at(-1)!;
    expect(last.order).toEqual([0, 3, 2, 1]);
    expect(traceDfsStack(FAN(), 0, 'pop').at(-1)!.order).toEqual([0, 3, 1, 2]);
  });

  it('skips from 3 a neighbour marked but never visited, and says so', () => {
    const frames = traceDfsStack(FAN(), 0, 'push');
    const look = frames.find((f) => f.event === 'look' && f.v === 3 && f.w === 1)!;
    expect(look.unvisited).toBe(true);
    expect(look.text).toBe(
      'Mira el vecino 1 de 3: está marcado y lo salta, pero el recorrido todavía no pasa por 1.',
    );
    // A neighbour already walked is skipped plainly.
    const back = frames.find((f) => f.event === 'look' && f.v === 3 && f.w === 0)!;
    expect(back.unvisited).toBe(false);
  });

  it('never pops a vertex twice', () => {
    const frames = traceDfsStack(SQUARE(), 0, 'push');
    expect(frames.some((f) => f.event === 'skip')).toBe(false);
    const pops = frames.filter((f) => f.event === 'pop').map((f) => f.v);
    expect(new Set(pops).size).toBe(pops.length);
  });
});

// The maze of #357 S5b: a dead end down from the entrance, which the walk
// takes first and backs out of, and the exit at the far corner.
//   . . . #
//   . # . .
//   . # # .
const MAZE = ['...#', '.#..', '.##.'];

describe('traceGridDfs (the depth-first search over a maze)', () => {
  it('numbers the cell in row r and column c as r · C + c, and walks them in the order Java does', () => {
    const frames = traceGridDfs(MAZE, 0);
    // Run on a JDK 21 against MazeDepthFirstPaths.java (S5b).
    expect(frames.at(-1)!.order).toEqual([0, 4, 8, 1, 2, 6, 7, 11]);
    expect(frames.at(-1)!.prev).toEqual([-1, 0, 1, -1, 0, -1, 2, 6, 4, -1, -1, 7]);
  });

  it('looks in the four directions of every cell, up, down, left, right, the walls and the border included', () => {
    const frames = traceGridDfs(MAZE, 0);
    const looksFrom0 = frames.filter((f) => f.event === 'look' && f.v === 0);
    expect(looksFrom0.map((f) => f.cell)).toEqual([
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]);
    expect(frames.filter((f) => f.event === 'look')).toHaveLength(4 * 8);
  });

  it('takes one step per assignment, direction, call and return: 62 on this maze', () => {
    expect(traceGridDfs(MAZE, 0)).toHaveLength(8 + 4 * 8 + 7 + 7 + 8);
  });

  it('says on each look why it does not step there: off the grid, a wall, or already marked', () => {
    const looks = traceGridDfs(MAZE, 0).filter((f) => f.event === 'look');
    const outside = looks[0];
    expect(outside).toMatchObject({ v: 0, w: null, blocked: true, seen: null });
    expect(outside.text).toBe(
      'Mira arriba de 0: (−1, 0) está fuera de la grilla, y free es false.',
    );
    const wall = looks.find((f) => f.v === 8 && f.cell?.[1] === 1)!;
    expect(wall).toMatchObject({ w: 9, blocked: true, seen: null });
    expect(wall.text).toBe('Mira a la derecha de 8: (2, 1) es muro, y free es false.');
    const back = looks.find((f) => f.v === 4 && f.w === 0)!;
    expect(back).toMatchObject({ blocked: false, seen: true });
    expect(back.text).toBe('Mira arriba de 4: 0 está libre, pero ya está marcada; la salta.');
    const open = looks.find((f) => f.v === 0 && f.w === 4)!;
    expect(open).toMatchObject({ blocked: false, seen: false });
    expect(open.text).toBe('Mira abajo de 0: 4 está libre y sin marcar.');
  });

  it('goes down the dead end first, backs out of it, and only then heads for the exit', () => {
    const frames = traceGridDfs(MAZE, 0);
    const returns = frames.filter((f) => f.event === 'return').map((f) => f.v);
    expect(returns.slice(0, 2)).toEqual([8, 4]);
    const deepest = frames.reduce((a, f) => Math.max(a, f.stack.length), 0);
    expect(deepest).toBe(6);
  });

  it('names the cell it marks by its number and its position', () => {
    expect(traceGridDfs(MAZE, 0)[0].text).toBe('dfs(0) marca la celda 0, en (0, 0).');
  });

  it('refuses rows of different lengths, a character other than . and #, and a start on a wall', () => {
    expect(() => traceGridDfs(['..', '.'], 0)).toThrow(RangeError);
    expect(() => traceGridDfs(['.x'], 0)).toThrow(RangeError);
    expect(() => traceGridDfs(MAZE, 3)).toThrow(RangeError);
    expect(() => traceGridDfs(MAZE, 12)).toThrow(RangeError);
  });
});

const DIAMOND = adjacencyOf(4, [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
]);
// The five-vertex graph of arc I: 0-1, 0-2, 1-3, 2-3, 3-4.
const FIVE = adjacencyOf(5, [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [3, 4],
]);

describe('traceBfs, marking on enqueue (the breadth-first search)', () => {
  it('marks the start, writes its distance, enqueues it, then dequeues, looks, marks, sets dist and prev, enqueues', () => {
    const events = traceBfs(DIAMOND, 0, 'push').map((f) => f.event);
    expect(events.slice(0, 9)).toEqual([
      'markStart',
      'distStart',
      'enqueueStart',
      'dequeue',
      'look',
      'mark',
      'dist',
      'prev',
      'enqueue',
    ]);
    expect(events.at(-1)).toBe('end');
  });

  it('visits by layers and gives each vertex its distance from the start', () => {
    const last = traceBfs(FIVE, 0, 'push').at(-1)!;
    expect(last.order).toEqual([0, 1, 2, 3, 4]);
    expect(last.dist).toEqual([0, 1, 1, 2, 3]);
    expect(last.prev).toEqual([-1, 0, 0, 1, 3]);
  });

  it('enqueues every vertex once', () => {
    const enqueued = traceBfs(DIAMOND, 0, 'push').filter((f) => f.event === 'enqueue');
    expect(enqueued.map((f) => f.w)).toEqual([1, 2, 3]);
    expect(enqueued.some((f) => f.twice)).toBe(false);
  });

  it('keeps the queue front first', () => {
    const f = traceBfs(DIAMOND, 0, 'push').find((x) => x.event === 'enqueue' && x.w === 2)!;
    expect(f.stack).toEqual([1, 2]);
  });

  it('never reaches a vertex with no path from the start, whose dist stays −1', () => {
    const last = traceBfs(adjacencyOf(3, [[0, 1]]), 0, 'push').at(-1)!;
    expect(last.dist).toEqual([0, 1, -1]);
  });
});

describe('traceBfs, marking on dequeue (the tempting version)', () => {
  it('enqueues a vertex twice when two vertices of one layer reach it', () => {
    const frames = traceBfs(DIAMOND, 0, 'pop');
    const enqueued = frames.filter((f) => f.event === 'enqueue');
    expect(enqueued.map((f) => [f.v, f.w, f.twice])).toEqual([
      [0, 1, false],
      [0, 2, false],
      [1, 3, false],
      [2, 3, true],
    ]);
    expect(frames.filter((f) => f.event === 'skip').map((f) => f.v)).toEqual([3]);
  });

  it('keeps neither dist nor prev', () => {
    const last = traceBfs(DIAMOND, 0, 'pop').at(-1)!;
    expect(last.dist).toBeNull();
    expect(last.prev).toEqual([-1, -1, -1, -1]);
  });

  it('says a vertex not yet marked is already in the queue', () => {
    const look = traceBfs(DIAMOND, 0, 'pop').find(
      (f) => f.event === 'look' && f.v === 2 && f.w === 3,
    )!;
    expect(look.text).toBe('Mira el vecino 3 de 2: no está marcado, aunque ya está en la cola.');
  });
});

// The six-course malla of #357's arc III: 0 Cálculo I, 1 Álgebra,
// 2 Programación, 3 Cálculo II, 4 Ecuaciones, 5 Estructuras de Datos.
const MALLA = adjacencyOf(
  6,
  [
    [0, 3],
    [3, 4],
    [1, 4],
    [2, 5],
    [1, 5],
  ],
  true,
);

describe('traceKahn (the topological order)', () => {
  it('orders the malla as Topological.java does on a JDK 21: 0, 1, 2, 3, 5, 4', () => {
    const last = traceKahn(MALLA).at(-1)!;
    expect(last.order).toEqual([0, 1, 2, 3, 5, 4]);
    expect(last.inDegree).toEqual([0, 0, 0, 0, 0, 0]);
    expect(last.text).toBe(
      'La cola quedó vacía con los 6 vértices en la línea: es un orden topológico.',
    );
  });

  it('counts the in-degrees first, then asks every vertex whether it is a source', () => {
    const frames = traceKahn(MALLA);
    expect(frames[0]).toMatchObject({ event: 'inDegrees', inDegree: [0, 0, 0, 1, 2, 2] });
    expect(frames.slice(1, 7).map((f) => [f.event, f.w])).toEqual([
      ['enqueueStart', 0],
      ['enqueueStart', 1],
      ['enqueueStart', 2],
      ['check', 3],
      ['check', 4],
      ['check', 5],
    ]);
  });

  it('lowers the head of each arc once, and enqueues a vertex when its in-degree reaches 0', () => {
    const frames = traceKahn(MALLA);
    expect(frames.filter((f) => f.event === 'lower')).toHaveLength(5);
    expect(frames.filter((f) => f.event === 'enqueue').map((f) => f.w)).toEqual([3, 5, 4]);
    const lowered = frames.find((f) => f.event === 'lower' && f.v === 1 && f.w === 4)!;
    expect(lowered.text).toBe('El arco 1 → 4 deja de contar: inDegree[4] baja a 1.');
  });

  it('takes each arc out of the graph as it stops counting (#357 review round 3)', () => {
    const frames = traceKahn(MALLA);
    const lowered = frames.find((f) => f.event === 'lower' && f.v === 1 && f.w === 4)!;
    // 0 → 3 went with 0; 1 → 4 goes now; 1 → 5 is still there.
    expect(lowered.gone).toEqual([
      [0, 3],
      [1, 4],
    ]);
    expect(frames.at(-1)!.gone).toHaveLength(5);
    expect(frames[0].gone).toEqual([]);
  });

  it('leaves the vertices of a cycle off the line, and says so', () => {
    const cyclic = adjacencyOf(
      5,
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 1],
        [3, 4],
      ],
      true,
    );
    const last = traceKahn(cyclic).at(-1)!;
    expect(last.order).toEqual([0]);
    expect(last.text).toBe(
      'La cola quedó vacía con 1 de 5 vértices en la línea: entre los que faltan hay un ciclo.',
    );
  });
});

describe('a depth-first walk without prev (#357 v2: the search that only marks)', () => {
  const SQUARE = adjacencyOf(4, [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]);

  it('records no prev frame and leaves prev at −1, recursive and with a stack', () => {
    for (const frames of [traceDfs(SQUARE, 0, false), traceDfsStack(SQUARE, 0, 'pop', false)]) {
      expect(frames.some((f) => f.event === 'prev')).toBe(false);
      expect(frames.at(-1)!.prev).toEqual([-1, -1, -1, -1]);
      expect(frames.at(-1)!.marked).toEqual([true, true, true, true]);
    }
  });

  it('walks in the same order as with prev', () => {
    const order = (frames: ReturnType<typeof traceDfs>) => frames.at(-1)!.order;
    expect(order(traceDfs(SQUARE, 0, false))).toEqual(order(traceDfs(SQUARE, 0)));
    expect(order(traceDfsStack(SQUARE, 0, 'pop', false))).toEqual(
      order(traceDfsStack(SQUARE, 0, 'pop')),
    );
  });
});

describe('the step marking on push makes, narrated (#357 review rounds 1 and 2)', () => {
  it('says the walk leaves a vertex with a neighbour it never walked to', () => {
    const fan = adjacencyOf(4, [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 3],
    ]);
    const jump = traceDfsStack(fan, 0, 'push').find((f) => f.event === 'pop' && f.v === 2)!;
    expect(jump.text).toBe('Saca 2 de la pila y sigue desde ahí: deja 3 sin recorrer su vecino 1.');
    const step = traceDfsStack(fan, 0, 'push').find((f) => f.event === 'pop' && f.v === 3)!;
    expect(step.text).toBe('Saca 3 de la pila y sigue desde ahí.');
    // From 2, whose only neighbour is walked, going on to 1 is a plain step
    // back, as any walk in depth makes: not flagged.
    const back = traceDfsStack(fan, 0, 'push').find((f) => f.event === 'pop' && f.v === 1)!;
    expect(back.text).toBe('Saca 1 de la pila y sigue desde ahí.');
  });
});
