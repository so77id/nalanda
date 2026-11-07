import { describe, expect, it } from 'vitest';

import {
  NODE_R,
  STEP_SPACE,
  crowdedVertices,
  layoutNodeGraph,
  pointOnEdge,
  stepMarks,
  walkStrokes,
  type NodeGraphEdge,
  type NodeGraphNode,
  type Point,
} from './nodeGraphLayout';

const TWO: NodeGraphNode[] = [
  { v: 'A', x: 0, y: 0 },
  { v: 'B', x: 2, y: 0 },
];

const lay = (nodes: NodeGraphNode[], edges: NodeGraphEdge[], directed = false) =>
  layoutNodeGraph({ nodes, edges, cols: 3, rows: 1, directed });

/** The numbers of an SVG path or points list, in order. */
const nums = (s: string) => s.match(/-?\d+(\.\d+)?/g)!.map(Number);
const dist = (p: Point, x: number, y: number) => Math.hypot(x - p.x, y - p.y);

describe('layoutNodeGraph', () => {
  it('draws a lone edge straight, from circle to circle', () => {
    const { edges, at } = lay(TWO, [['A', 'B']]);
    expect(edges[0].d).not.toContain('Q');
    const [x1, y1, x2, y2] = nums(edges[0].d);
    expect(dist(at.get('A')!, x1, y1)).toBeCloseTo(NODE_R, 0);
    expect(dist(at.get('B')!, x2, y2)).toBeCloseTo(NODE_R, 0);
  });

  it('bends two edges between the same two nodes to opposite sides', () => {
    const { edges, at } = lay(TWO, [
      ['A', 'B'],
      ['A', 'B'],
    ]);
    const line = at.get('A')!.y;
    const sides = edges.map((e) => Math.sign(nums(e.d)[3] - line));
    expect(sides[0]).not.toBe(0);
    expect(sides[1]).toBe(-sides[0]);
  });

  it('bends a → b and b → a apart in a directed graph', () => {
    const { edges, at } = lay(
      TWO,
      [
        ['A', 'B'],
        ['B', 'A'],
      ],
      true,
    );
    const line = at.get('A')!.y;
    const sides = edges.map((e) => Math.sign(nums(e.d)[3] - line));
    expect(sides[0]).not.toBe(0);
    expect(sides[1]).toBe(-sides[0]);
  });

  it('ends a directed edge in an arrowhead whose tip touches the target', () => {
    const directed = lay(TWO, [['A', 'B']], true).edges[0];
    const [tipX, tipY] = nums(directed.arrow!);
    expect(dist(lay(TWO, []).at.get('B')!, tipX, tipY)).toBeCloseTo(NODE_R, 0);
    expect(lay(TWO, [['A', 'B']]).edges[0].arrow).toBeUndefined();
  });

  it('puts a weight in the middle of its edge', () => {
    const { edges, at } = lay(TWO, [['A', 'B', 7]]);
    const a = at.get('A')!;
    const b = at.get('B')!;
    expect(edges[0].weight).toBe('7');
    expect(edges[0].weightAt).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });

  it('finds a point along each edge, its middle apart for parallel edges', () => {
    const { edges, at } = lay(TWO, [
      ['A', 'B'],
      ['A', 'B'],
      ['A', 'B'],
    ]);
    const a = at.get('A')!;
    const b = at.get('B')!;
    expect(pointOnEdge(edges[1], 0)).toEqual(a);
    expect(pointOnEdge(edges[1], 1)).toEqual(b);
    const middles = edges.map((e) => pointOnEdge(e, 0.5));
    expect(middles).toContainEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    expect(new Set(middles.map((m) => `${m.x},${m.y}`)).size).toBe(3);
  });

  it('finds the edge each step of a walk takes, parallel ones in turn', () => {
    const edges: NodeGraphEdge[] = [
      ['A', 'B'],
      ['A', 'B'],
      ['B', 'C'],
    ];
    expect(walkStrokes(edges, ['C', 'B', 'A', 'B'], false)).toEqual([2, 0, 1]);
    expect(walkStrokes(edges, ['A', 'C'], false)).toBeNull();
    expect(walkStrokes(edges, ['B', 'A'], true)).toBeNull();
  });

  it('draws a self-loop as a curve that leaves and returns to its node, where there is room', () => {
    const layout = layoutNodeGraph({
      cols: 3,
      rows: 2,
      nodes: [
        { v: 'A', x: 0, y: 1 },
        { v: 'B', x: 2, y: 1 },
      ],
      edges: [
        ['A', 'B'],
        ['A', 'A', 3],
      ],
      directed: true,
    });
    const loop = layout.edges[1];
    const a = layout.at.get('A')!;
    expect(loop.from).toBe('A');
    expect(loop.to).toBe('A');
    expect(loop.d).toMatch(/^M[\d.]+,[\d.]+ C/);
    expect(loop.arrow).toBeDefined();
    // The edge to B leaves to the right, leaving the top free: the loop goes up, its weight on top.
    expect(loop.weightAt!.y).toBeLessThan(a.y - 40);
    expect(Math.abs(loop.weightAt!.x - a.x)).toBeLessThan(1);
    expect(pointOnEdge(loop, 0.5).y).toBeLessThan(a.y - 30);
  });

  it('turns a self-loop away from edges that leave its node upwards', () => {
    const layout = layoutNodeGraph({
      cols: 3,
      rows: 2,
      nodes: [
        { v: 'A', x: 0, y: 1 },
        { v: 'B', x: 0, y: 0 },
        { v: 'C', x: 2, y: 0 },
      ],
      edges: [
        ['A', 'B'],
        ['A', 'C'],
        ['A', 'A'],
      ],
      directed: false,
    });
    const a = layout.at.get('A')!;
    const apex = pointOnEdge(layout.edges[2], 0.5);
    expect(apex.y).toBeGreaterThan(a.y - 1);
  });

  it('draws parallel edges through the middle where their weights sit', () => {
    for (const n of [2, 3]) {
      const edges: NodeGraphEdge[] = Array.from({ length: n }, (_, i) => ['A', 'B', i + 1]);
      const { edges: laid } = layoutNodeGraph({
        nodes: TWO,
        edges,
        cols: 3,
        rows: 1,
        directed: false,
      });
      for (const e of laid) {
        const nums = e.d.match(/-?[\d.]+/g)!.map(Number);
        if (nums.length < 6) continue; // the straight one
        const [sx, sy, cx, cy, ex, ey] = nums;
        const mx = sx / 4 + cx / 2 + ex / 4;
        const my = sy / 4 + cy / 2 + ey / 4;
        expect(Math.hypot(mx - e.weightAt!.x, my - e.weightAt!.y)).toBeLessThan(0.5);
      }
    }
  });

  it('walks a self-loop, directed or not', () => {
    const edges: NodeGraphEdge[] = [
      ['A', 'B'],
      ['A', 'A'],
    ];
    expect(walkStrokes(edges, ['B', 'A', 'A'], false)).toEqual([0, 1]);
    expect(walkStrokes(edges, ['A', 'A', 'B'], true)).toEqual([1, 0]);
    expect(walkStrokes(edges, ['B', 'A', 'A'], true)).toBeNull();
  });

  it('turns two self-loops on one node different ways', () => {
    const { edges: laid } = layoutNodeGraph({
      nodes: [{ v: 'A', x: 1, y: 1 }],
      edges: [
        ['A', 'A'],
        ['A', 'A'],
      ],
      cols: 3,
      rows: 3,
      directed: false,
    });
    const [first, second] = laid.map((e) => pointOnEdge(e, 0.5));
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(20);
  });

  it('puts a note on the side its edges leave free', () => {
    const { noteAt, at } = lay(TWO, [['A', 'B']]);
    // A's only edge leaves to the right, so its note goes to the left.
    expect(noteAt.get('A')!.x).toBeLessThan(at.get('A')!.x);
    expect(noteAt.get('A')!.y).toBeCloseTo(at.get('A')!.y, 5);
  });

  it('puts the note of a node without edges at its upper right', () => {
    const { noteAt, at } = lay(TWO, []);
    expect(noteAt.get('A')!.x).toBeGreaterThan(at.get('A')!.x);
    expect(noteAt.get('A')!.y).toBeLessThan(at.get('A')!.y);
  });

  it('widens a node whose label is longer than two characters', () => {
    const { halfW } = lay(
      [
        { v: 'Ana', x: 0, y: 0 },
        { v: 'B', x: 2, y: 0 },
      ],
      [],
    );
    expect(halfW.get('B')).toBe(NODE_R);
    expect(halfW.get('Ana')!).toBeGreaterThan(NODE_R);
  });

  it('stops an edge at a wide node’s border, not inside it', () => {
    const { edges, at, halfW } = lay(
      [
        { v: 'Ana', x: 0, y: 0 },
        { v: 'B', x: 2, y: 0 },
      ],
      [['Ana', 'B']],
    );
    const [x1, y1] = nums(edges[0].d);
    expect(dist(at.get('Ana')!, x1, y1)).toBeCloseTo(halfW.get('Ana')!, 0);
  });

  it('makes room for a wide node at the edge of the grid', () => {
    const { at, halfW, width } = lay(
      [
        { v: 'Valparaíso', x: 0, y: 0 },
        { v: 'Temuco', x: 2, y: 0 },
      ],
      [],
    );
    for (const v of ['Valparaíso', 'Temuco']) {
      expect(at.get(v)!.x - halfW.get(v)!).toBeGreaterThanOrEqual(0);
      expect(at.get(v)!.x + halfW.get(v)!).toBeLessThanOrEqual(width);
    }
  });

  it('runs an edge from centre to centre when told not to trim it, as a figure', () => {
    const { edges, at } = layoutNodeGraph({
      nodes: TWO,
      edges: [['A', 'B']],
      cols: 3,
      rows: 1,
      directed: false,
      trim: false,
    });
    const [x1, y1, x2, y2] = nums(edges[0].d);
    expect(dist(at.get('A')!, x1, y1)).toBeCloseTo(0, 0);
    expect(dist(at.get('B')!, x2, y2)).toBeCloseTo(0, 0);
  });

  it('grows the drawing when a note falls below its last row', () => {
    // B's only edge leaves upwards, so its note goes below it.
    const nodes: NodeGraphNode[] = [
      { v: 'A', x: 0, y: 0 },
      { v: 'B', x: 0, y: 1 },
    ];
    const plain = layoutNodeGraph({
      nodes,
      edges: [['A', 'B']],
      cols: 1,
      rows: 2,
      directed: false,
    });
    const noted = layoutNodeGraph({
      nodes,
      edges: [['A', 'B']],
      cols: 1,
      rows: 2,
      directed: false,
      noted: ['B'],
    });
    expect(noted.noteAt.get('B')!.y).toBeGreaterThan(plain.drawingH - 18);
    expect(noted.drawingH).toBeGreaterThanOrEqual(noted.noteAt.get('B')!.y + 10);
  });

  it('keeps a circles-only drawing exactly where it was before #356', () => {
    // Árboles I and II mount these; their geometry must not move.
    const { width, drawingH, at } = layoutNodeGraph({
      nodes: [
        { v: '+', x: 1, y: 0 },
        { v: 3, x: 0, y: 1 },
      ],
      edges: [['+', 3]],
      cols: 3,
      rows: 2,
      directed: false,
    });
    expect(width).toBe(2 * 18 + 3 * 52);
    expect(drawingH).toBe(2 * 18 + 2 * NODE_R + 58);
    expect(at.get('+')).toEqual({ x: 18 + 1.5 * 52, y: 18 + NODE_R });
  });
});

describe('crowdedVertices', () => {
  it('finds two vertices in one place, or with one value', () => {
    expect(crowdedVertices(TWO)).toBeNull();
    expect(crowdedVertices([...TWO, { v: 'C', x: 0, y: 0 }])).toEqual(['A', 'C']);
    expect(crowdedVertices([...TWO, { v: 'A', x: 1, y: 1 }])).toEqual(['A', 'A']);
  });
});

describe('stepMarks', () => {
  // Königsberg with a bridge B–C: B–C and A–D cross at the middle of the drawing.
  const nodes: NodeGraphNode[] = [
    { v: 'B', x: 1, y: 0 },
    { v: 'A', x: 0, y: 1 },
    { v: 'D', x: 2, y: 1 },
    { v: 'C', x: 1, y: 2 },
  ];
  const edges: NodeGraphEdge[] = [
    ['A', 'B'],
    ['A', 'B'],
    ['A', 'C'],
    ['A', 'C'],
    ['A', 'D'],
    ['B', 'D'],
    ['C', 'D'],
    ['B', 'C'],
  ];
  const traced = (graph: NodeGraphEdge[], ...path: string[]) => ({
    path,
    used: walkStrokes(graph, path, false)!,
  });

  it('numbers each drawn stroke by its step, at the middle of the stroke when it is free', () => {
    const layout = layoutNodeGraph({ nodes, edges, cols: 3, rows: 3, directed: false });
    const marks = stepMarks(layout, traced(edges, 'A', 'D', 'B'));
    expect(marks.map((m) => [m.stroke, m.step])).toEqual([
      [4, 1],
      [5, 2],
    ]);
    const ad = layout.edges[4].curve;
    expect(marks[0]).toMatchObject({
      x: (ad.from.x + ad.to.x) / 2,
      y: (ad.from.y + ad.to.y) / 2,
    });
  });

  it.each([
    ['one more bridge, B–C', edges, 'ABACADBCD'],
    ['two more bridges, B–C and A–D', [...edges, ['A', 'D']] as NodeGraphEdge[], 'BABDACADCB'],
  ])('keeps every number off the points and apart from the others: %s', (_name, graph, tour) => {
    const laid = layoutNodeGraph({ nodes, edges: graph, cols: 3, rows: 3, directed: false });
    const marks = stepMarks(laid, traced(graph, ...tour.split('')));
    expect(marks).toHaveLength(graph.length);
    for (const m of marks) {
      for (const p of laid.at.values()) {
        expect(Math.hypot(m.x - p.x, m.y - p.y)).toBeGreaterThanOrEqual(STEP_SPACE.clear);
      }
      for (const o of marks) {
        if (o !== m)
          expect(Math.hypot(m.x - o.x, m.y - o.y)).toBeGreaterThanOrEqual(STEP_SPACE.gap);
      }
    }
  });
});
