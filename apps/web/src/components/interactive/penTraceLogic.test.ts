import { describe, expect, it } from 'vitest';

import type { NodeGraphEdge } from '../nodeGraphLayout';
import {
  EMPTY_TRACE,
  remaining,
  solve,
  status,
  step,
  undo,
  type TraceState,
} from './penTraceLogic';

/** A triangle A, B, C with a tail C–D: D and C have odd degree. */
const KITE: NodeGraphEdge[] = [
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'A'],
  ['C', 'D'],
];

/** Two bridges between the same two banks. */
const TWO_BRIDGES: NodeGraphEdge[] = [
  ['A', 'B'],
  ['A', 'B'],
];

const walk = (edges: NodeGraphEdge[], points: string[]): TraceState | null =>
  points.reduce<TraceState | null>((s, p) => (s === null ? null : step(edges, s, p)), EMPTY_TRACE);

describe('penTraceLogic', () => {
  it('puts the pen down on the first point pressed, drawing nothing', () => {
    expect(step(KITE, EMPTY_TRACE, 'B')).toEqual({ path: ['B'], used: [] });
  });

  it('draws the stroke to a neighbouring point', () => {
    expect(walk(KITE, ['A', 'B'])).toEqual({ path: ['A', 'B'], used: [0] });
  });

  it('draws a stroke in either direction it was written', () => {
    expect(walk(KITE, ['B', 'A'])).toEqual({ path: ['B', 'A'], used: [0] });
  });

  it('refuses a jump to a point no stroke reaches', () => {
    expect(step(KITE, walk(KITE, ['A'])!, 'D')).toBeNull();
  });

  it('refuses a stroke already drawn', () => {
    expect(step(KITE, walk(KITE, ['A', 'B'])!, 'A')).toBeNull();
  });

  it('draws each of two parallel strokes once', () => {
    const there = walk(TWO_BRIDGES, ['A', 'B', 'A'])!;
    expect(there.used).toEqual([0, 1]);
    expect(step(TWO_BRIDGES, there, 'B')).toBeNull();
  });

  it('undoes the last stroke, and lifts the pen when none is left', () => {
    const two = walk(KITE, ['A', 'B', 'C'])!;
    expect(undo(two)).toEqual({ path: ['A', 'B'], used: [0] });
    expect(undo(walk(KITE, ['A'])!)).toEqual(EMPTY_TRACE);
  });

  it('counts the strokes still to draw', () => {
    expect(remaining(KITE, walk(KITE, ['A', 'B'])!)).toBe(3);
  });

  it('is empty before the pen goes down, and drawing while a stroke leaves the point', () => {
    expect(status(KITE, EMPTY_TRACE)).toBe('empty');
    expect(status(KITE, walk(KITE, ['A', 'B'])!)).toBe('drawing');
  });

  it('is stuck when strokes remain and none leaves the point', () => {
    // A, B, C, A closes the triangle and leaves C–D undrawn, away from A.
    expect(status(KITE, walk(KITE, ['A', 'B', 'C', 'A'])!)).toBe('stuck');
  });

  it('is done when every stroke is drawn', () => {
    expect(status(KITE, walk(KITE, ['D', 'C', 'A', 'B', 'C'])!)).toBe('done');
  });
});

/** A square with both diagonals: the envelope, four odd corners. */
const ENVELOPE: NodeGraphEdge[] = [
  ['A', 'B'],
  ['C', 'D'],
  ['A', 'C'],
  ['B', 'D'],
  ['A', 'E'],
  ['E', 'D'],
  ['B', 'E'],
  ['E', 'C'],
];

/** The house: a square with both diagonals and a roof, odd at its bottom corners D and E. */
const HOUSE: NodeGraphEdge[] = [
  ['A', 'B'],
  ['A', 'C'],
  ['B', 'C'],
  ['B', 'D'],
  ['C', 'E'],
  ['D', 'E'],
  ['B', 'F'],
  ['F', 'E'],
  ['C', 'F'],
  ['F', 'D'],
];

/** Königsberg: four odd banks, with two pairs of parallel bridges. */
const KONIGSBERG: NodeGraphEdge[] = [
  ['A', 'B'],
  ['A', 'B'],
  ['A', 'C'],
  ['A', 'C'],
  ['A', 'D'],
  ['B', 'D'],
  ['C', 'D'],
];

/** Two separate triangles: every degree even, and still not one stroke. */
const TWO_TRIANGLES: NodeGraphEdge[] = [
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'A'],
  ['D', 'E'],
  ['E', 'F'],
  ['F', 'D'],
];

/** A solution is good when pressing its points, in order, draws every stroke. */
const solves = (edges: NodeGraphEdge[], points: string[]) =>
  status(edges, walk(edges, points) ?? EMPTY_TRACE) === 'done';

describe('solve', () => {
  it('traces a figure with two odd points from one to the other', () => {
    const points = solve(HOUSE, ['A', 'B', 'C', 'F', 'D', 'E'])!;
    expect(solves(HOUSE, points)).toBe(true);
    expect([points[0], points[points.length - 1]].sort()).toEqual(['D', 'E']);
  });

  it('starts at the first odd point in the order given', () => {
    expect(solve(HOUSE, ['A', 'B', 'C', 'F', 'E', 'D'])![0]).toBe('E');
  });

  it('closes a figure with no odd point where it began', () => {
    const points = solve(TWO_BRIDGES, ['A', 'B'])!;
    expect(solves(TWO_BRIDGES, points)).toBe(true);
    expect(points[0]).toBe(points[points.length - 1]);
  });

  it('uses each of two parallel strokes once', () => {
    const edges: NodeGraphEdge[] = [...TWO_BRIDGES, ['B', 'C']];
    const points = solve(edges, ['A', 'B', 'C'])!;
    expect(points).toHaveLength(edges.length + 1);
    expect(solves(edges, points)).toBe(true);
  });

  it('finds the tracing a first greedy walk would miss', () => {
    // From D the walk can close the triangle too early; Hierholzer splices it back.
    const points = solve(KITE, ['A', 'B', 'C', 'D'])!;
    expect(solves(KITE, points)).toBe(true);
  });

  it('has no solution with more than two odd points', () => {
    expect(solve(ENVELOPE, ['A', 'B', 'E', 'C', 'D'])).toBeNull();
    expect(solve(KONIGSBERG, ['B', 'A', 'D', 'C'])).toBeNull();
  });

  it('has no solution when the strokes are in two pieces', () => {
    expect(solve(TWO_TRIANGLES, ['A', 'B', 'C', 'D', 'E', 'F'])).toBeNull();
  });
});
