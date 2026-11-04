import { describe, expect, it } from 'vitest';

import {
  NODE_R,
  layoutNodeGraph,
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
