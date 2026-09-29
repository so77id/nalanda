import { describe, expect, it } from 'vitest';

import { HEAP_BOX, HEAP_NODE_R, heapEdge, layoutHeap } from './sequenceStepperHeapLayout';

/**
 * The heap recipe's geometry, checked exactly rather than measured
 * (`apps/web/CLAUDE.md` §2, "the way out is to not measure"): the tree is the
 * array's complete binary tree, so where each node sits follows from its
 * index alone, and what a browser is left to confirm is that it looks right.
 */

describe('sequenceStepperHeapLayout · the tree', () => {
  it('places node k on level floor(log2 k), one row per level', () => {
    const { tree } = layoutHeap(8, 9);
    const rowOf = (k: number) => tree.nodes[k - 1]!.cy;
    expect(rowOf(1)).toBeLessThan(rowOf(2));
    expect(rowOf(2)).toBe(rowOf(3));
    expect(rowOf(3)).toBeLessThan(rowOf(4));
    expect(rowOf(4)).toBe(rowOf(7));
    expect(rowOf(7)).toBeLessThan(rowOf(8));
  });

  it('centres every parent over its two children', () => {
    const { tree } = layoutHeap(7, 8);
    for (let k = 1; 2 * k + 1 <= 7; k += 1) {
      const [p, l, r] = [tree.nodes[k - 1]!, tree.nodes[2 * k - 1]!, tree.nodes[2 * k]!];
      expect(p.cx).toBeCloseTo((l.cx + r.cx) / 2);
    }
  });

  it('keeps a left child left of its right sibling, level by level', () => {
    const { tree } = layoutHeap(8, 9);
    for (let k = 2; k < 8; k += 1) {
      const a = tree.nodes[k - 1]!;
      const b = tree.nodes[k]!;
      if (a.cy === b.cy) expect(a.cx).toBeLessThan(b.cx);
    }
  });

  it('never lets two nodes touch, and keeps every node inside the canvas', () => {
    for (let n = 1; n <= 8; n += 1) {
      const { tree } = layoutHeap(n, n + 1);
      expect(tree.nodes).toHaveLength(n);
      for (const a of tree.nodes) {
        expect(a.cx - HEAP_NODE_R).toBeGreaterThanOrEqual(0);
        expect(a.cx + HEAP_NODE_R).toBeLessThanOrEqual(tree.width);
        expect(a.cy - HEAP_NODE_R).toBeGreaterThanOrEqual(0);
        expect(a.cy + HEAP_NODE_R).toBeLessThanOrEqual(tree.height);
        for (const b of tree.nodes) {
          if (a === b) continue;
          expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan(2 * HEAP_NODE_R + 4);
        }
      }
    }
  });

  it('is sized for the largest heap of the run, so it does not jump between frames', () => {
    // Five nodes need three levels; the widest frame decides, not this one.
    const five = layoutHeap(5, 6).tree;
    const eight = layoutHeap(8, 9).tree;
    expect(eight.height).toBeGreaterThan(five.height);
    expect(eight.width).toBeGreaterThanOrEqual(five.width);
  });

  it('still returns a canvas for a heap that starts empty', () => {
    const { tree } = layoutHeap(0, 1);
    expect(tree.nodes).toHaveLength(0);
    expect(tree.width).toBeGreaterThan(0);
    expect(tree.height).toBeGreaterThan(0);
  });
});

describe('sequenceStepperHeapLayout · the edges', () => {
  it('runs each edge from the rim of the parent to the rim of the child', () => {
    const layout = layoutHeap(6, 7);
    for (let k = 2; k <= 6; k += 1) {
      const e = heapEdge(layout, k);
      const parent = layout.tree.nodes[Math.floor(k / 2) - 1]!;
      const child = layout.tree.nodes[k - 1]!;
      expect(Math.hypot(e.x1 - parent.cx, e.y1 - parent.cy)).toBeCloseTo(HEAP_NODE_R);
      expect(Math.hypot(e.x2 - child.cx, e.y2 - child.cy)).toBeCloseTo(HEAP_NODE_R);
      expect(e.y2).toBeGreaterThan(e.y1);
    }
  });
});

describe('sequenceStepperHeapLayout · the array', () => {
  it('draws slot 0 first, then data[1..], contiguous, for the whole block', () => {
    const { array } = layoutHeap(5, 8);
    expect(array.boxes).toHaveLength(8);
    expect(array.boxes.map((b) => b.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let i = 1; i < array.boxes.length; i += 1) {
      expect(array.boxes[i]!.x).toBe(array.boxes[i - 1]!.x + HEAP_BOX);
    }
    const lastBox = array.boxes.at(-1)!;
    expect(lastBox.x + HEAP_BOX).toBeLessThanOrEqual(array.width);
  });

  it('keeps the index rail, the cursors and the slot-0 note below the cells, in that order', () => {
    const { array } = layoutHeap(5, 8);
    const bottom = array.boxes[0]!.y + HEAP_BOX;
    expect(array.railY).toBeGreaterThan(bottom);
    expect(array.pointerY).toBeGreaterThan(array.railY);
    expect(array.height).toBeGreaterThan(array.pointerY);
  });

  it('reserves room for the widest block the run reaches', () => {
    // A block that doubles mid-run extends into room already there.
    expect(layoutHeap(5, 6, 12).array.width).toBe(layoutHeap(5, 12).array.width);
    expect(layoutHeap(5, 6, 12).array.boxes).toHaveLength(6);
  });
});
