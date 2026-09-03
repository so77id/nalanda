import { describe, expect, it } from 'vitest';

import {
  traceBubble,
  traceInsertion,
  traceMerge,
  traceQuick,
  traceSelection,
} from './sortStepperTrace';

// The traces are pure and testable without a browser. What matters for the
// widget is: (1) every trace ends on the sorted input, (2) every intermediate
// snapshot is a permutation of the input, (3) the terminal 'done' frame's
// array equals the sorted result, (4) frames carry the right cross-references
// (subarray, callNode) for the tree-driven algorithms.

function isPermutation(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join(',') === [...b].sort().join(',');
}

const INPUT = [5, 2, 8, 1, 4, 7, 3, 6];
const SORTED = [1, 2, 3, 4, 5, 6, 7, 8];

describe('sortStepperTrace', () => {
  describe('bubble', () => {
    it('finishes with a sorted array', () => {
      const { steps, sorted } = traceBubble(INPUT);
      expect(sorted).toEqual(SORTED);
      expect(steps[steps.length - 1]?.array).toEqual(SORTED);
    });

    it('emits at least one compare per adjacent pair', () => {
      const { steps } = traceBubble(INPUT);
      const compares = steps.filter((s) => s.kind === 'compare');
      // First pass alone: (n-1) compares. Full sort emits at least that many.
      expect(compares.length).toBeGreaterThanOrEqual(INPUT.length - 1);
    });

    it('marks a growing sortedSuffix as passes complete', () => {
      const { steps } = traceBubble(INPUT);
      // Terminal frame: whole array is sorted-suffix.
      const last = steps[steps.length - 1]!;
      expect(last.sortedSuffix).toBe(INPUT.length);
    });

    it('every snapshot is a permutation of the input', () => {
      const { steps } = traceBubble(INPUT);
      for (const s of steps) expect(isPermutation(s.array, INPUT)).toBe(true);
    });
  });

  describe('selection', () => {
    it('finishes with a sorted array', () => {
      const { steps, sorted } = traceSelection(INPUT);
      expect(sorted).toEqual(SORTED);
      expect(steps[steps.length - 1]?.array).toEqual(SORTED);
    });

    it('emits a select-min frame at the start of every pass', () => {
      const { steps } = traceSelection(INPUT);
      const opens = steps.filter((s) => s.kind === 'select-min');
      // At least one open per outer-loop iteration (7 for length 8).
      expect(opens.length).toBeGreaterThanOrEqual(INPUT.length - 1);
    });

    it('sortedPrefix grows monotonically across swap frames', () => {
      const { steps } = traceSelection(INPUT);
      const swaps = steps.filter((s) => s.kind === 'swap').map((s) => s.sortedPrefix ?? 0);
      for (let i = 1; i < swaps.length; i += 1) {
        expect(swaps[i]!).toBeGreaterThanOrEqual(swaps[i - 1]!);
      }
    });
  });

  describe('insertion', () => {
    it('finishes with a sorted array', () => {
      const { steps, sorted } = traceInsertion(INPUT);
      expect(sorted).toEqual(SORTED);
      expect(steps[steps.length - 1]?.array).toEqual(SORTED);
    });

    it('emits an insert frame for every element after the first', () => {
      const { steps } = traceInsertion(INPUT);
      const inserts = steps.filter((s) => s.kind === 'insert');
      expect(inserts.length).toBe(INPUT.length - 1);
    });

    it('makes N-1 comparisons on an already-sorted input (adaptive property)', () => {
      const { steps } = traceInsertion(SORTED);
      // Insertion sort on an already-sorted array: one compare per outer-loop
      // iteration (all "stop immediately, no shift"). That's exactly N-1.
      const compares = steps.filter((s) => s.kind === 'compare');
      expect(compares.length).toBe(SORTED.length - 1);
    });
  });

  describe('merge', () => {
    it('finishes with a sorted array', () => {
      const { steps, sorted } = traceMerge(INPUT);
      expect(sorted).toEqual(SORTED);
      expect(steps[steps.length - 1]?.array).toEqual(SORTED);
    });

    it('emits the top-level callNode as the root of the mergesort tree', () => {
      const { steps } = traceMerge([3, 7, 1, 5]);
      const enter = steps.find((s) => s.kind === 'enter');
      expect(enter?.callNode).toBe('mergesort([3,7,1,5])');
    });

    it('emits an enter frame for every recursive subarray', () => {
      const { steps } = traceMerge([3, 7, 1, 5]);
      const calls = steps.filter((s) => s.kind === 'enter').map((s) => s.callNode);
      // 7 calls: root, two halves, four leaves.
      expect(calls).toContain('mergesort([3,7,1,5])');
      expect(calls).toContain('mergesort([3,7])');
      expect(calls).toContain('mergesort([1,5])');
      expect(calls).toContain('mergesort([3])');
      expect(calls).toContain('mergesort([7])');
      expect(calls).toContain('mergesort([1])');
      expect(calls).toContain('mergesort([5])');
    });

    it('carries a callAnnotation on the initial merge frame', () => {
      const { steps } = traceMerge([3, 7, 1, 5]);
      const rootMerges = steps.filter(
        (s) => s.kind === 'merge-take' && s.callNode === 'mergesort([3,7,1,5])',
      );
      // The first merge-take on the root chip carries the "combinando [L]+[R]"
      // annotation for the reader.
      expect(rootMerges[0]?.callAnnotation).toMatch(/combinando/);
    });
  });

  describe('quick', () => {
    it('finishes with a sorted array', () => {
      const { steps, sorted } = traceQuick(INPUT);
      expect(sorted).toEqual(SORTED);
      expect(steps[steps.length - 1]?.array).toEqual(SORTED);
    });

    it('emits the top-level callNode as the root of the quicksort tree', () => {
      const { steps } = traceQuick([3, 7, 1, 5]);
      const enter = steps.find((s) => s.kind === 'enter');
      expect(enter?.callNode).toBe('quicksort([3,7,1,5])');
    });

    it('exposes the pivot on scan frames and lands it on partition-done', () => {
      const { steps } = traceQuick([3, 7, 1, 5]);
      // At the root: pivot=3 → left=[1], right=[7,5]. partition-done places
      // the pivot at index 1 (after left of length 1).
      const rootDone = steps.find(
        (s) => s.kind === 'partition-done' && s.callNode === 'quicksort([3,7,1,5])',
      );
      expect(rootDone?.pivot).toBe(1);
    });

    it('recurses on the SAME subarrays the DivideCombineTree recipe draws', () => {
      // Cross-widget contract: the tree's chips carry `quicksort([1])` and
      // `quicksort([7,5])` for the two children of `quicksort([3,7,1,5])`.
      // The stepper must emit `enter` frames with exactly those callNodes so
      // `highlightNode` lands on the matching chip.
      const { steps } = traceQuick([3, 7, 1, 5]);
      const enters = steps.filter((s) => s.kind === 'enter').map((s) => s.callNode);
      expect(enters).toContain('quicksort([1])');
      expect(enters).toContain('quicksort([7,5])');
    });
  });
});
