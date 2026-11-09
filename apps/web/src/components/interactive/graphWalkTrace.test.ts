import { describe, expect, it } from 'vitest';
import { adjacencyOf, traceDfs } from './graphWalkTrace';

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
