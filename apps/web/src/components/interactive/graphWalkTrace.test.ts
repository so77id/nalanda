import { describe, expect, it } from 'vitest';
import { adjacencyOf, traceDfs, traceDfsStack, traceGridDfs } from './graphWalkTrace';

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
    expect(frames[7].text).toBe('dfs(0) termina: no queda nada por recorrer.');
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
      'La pila quedó vacía: no queda nada por recorrer.',
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
