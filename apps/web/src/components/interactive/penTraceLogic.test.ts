import { describe, expect, it } from 'vitest';

import type { NodeGraphEdge } from '../nodeGraphLayout';
import { EMPTY_TRACE, remaining, status, step, undo, type TraceState } from './penTraceLogic';

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
