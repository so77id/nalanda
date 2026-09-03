import { describe, expect, it } from 'vitest';

import {
  allPermutations,
  buildDecisionTree,
  elementNames,
  factorial,
  leafCount,
  log2FactorialCeil,
  permToSorted,
  treeHeight,
  worstCaseLeaf,
} from './decisionTreeSortLogic';

describe('decisionTreeSort — pure trace', () => {
  describe('helpers', () => {
    it('names elements as a,b,c,...', () => {
      expect(elementNames(3)).toEqual(['a', 'b', 'c']);
      expect(elementNames(5)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('permToSorted maps a permutation to the sorted output string', () => {
      // perm[i] = rank(a[i]). If a[0]=b, a[1]=c, a[2]=a then perm=[1,2,0].
      // Sorted low-to-high: a[2], a[0], a[1] → "cab".
      expect(permToSorted([1, 2, 0])).toBe('cab');
      // Identity permutation: already sorted "abc".
      expect(permToSorted([0, 1, 2])).toBe('abc');
      // Reverse: "cba".
      expect(permToSorted([2, 1, 0])).toBe('cba');
    });

    it('allPermutations returns N! distinct permutations', () => {
      for (const n of [1, 2, 3, 4]) {
        const perms = allPermutations(n);
        expect(perms.length).toBe(factorial(n));
        // No duplicates.
        const set = new Set(perms.map((p) => p.join(',')));
        expect(set.size).toBe(perms.length);
      }
    });

    it('log2FactorialCeil matches the known bounds', () => {
      expect(log2FactorialCeil(2)).toBe(1); // log2(2)=1
      expect(log2FactorialCeil(3)).toBe(3); // log2(6)≈2.58 → 3
      expect(log2FactorialCeil(4)).toBe(5); // log2(24)≈4.58 → 5
    });
  });

  describe('buildDecisionTree', () => {
    it('produces a tree with exactly N! leaves for n=2,3,4', () => {
      for (const n of [2, 3, 4]) {
        const t = buildDecisionTree(n);
        expect(leafCount(t)).toBe(factorial(n));
      }
    });

    it('achieves the log₂(N!) height (the balanced tree hits the lower bound)', () => {
      for (const n of [2, 3, 4]) {
        const t = buildDecisionTree(n);
        expect(treeHeight(t)).toBe(log2FactorialCeil(n));
      }
    });

    it('every leaf carries a unique sorted-output string', () => {
      const t = buildDecisionTree(4);
      const leaves = collectLeaves(t);
      const outputs = new Set(leaves.map((l) => l.sorted));
      expect(outputs.size).toBe(leaves.length);
      expect(leaves.length).toBe(factorial(4));
    });

    it('internal nodes carry a comparison between two positions of the input', () => {
      const t = buildDecisionTree(3);
      // Root: some (i,j) with 0 ≤ i < j < 3.
      if (t.kind !== 'internal') throw new Error('expected an internal root for n=3');
      const [i, j] = t.compare;
      expect(i).toBeGreaterThanOrEqual(0);
      expect(j).toBeGreaterThan(i);
      expect(j).toBeLessThan(3);
    });
  });

  describe('worstCaseLeaf', () => {
    it('returns a leaf whose depth equals the tree height', () => {
      const t = buildDecisionTree(4);
      const worst = worstCaseLeaf(t);
      expect(worst.depth).toBe(treeHeight(t));
    });
  });
});

// Small helper for the tests only.
function collectLeaves(
  node: ReturnType<typeof buildDecisionTree>,
): { sorted: string; depth: number }[] {
  if (node.kind === 'leaf') return [{ sorted: node.sorted, depth: node.depth }];
  return [...collectLeaves(node.yes), ...collectLeaves(node.no)];
}
