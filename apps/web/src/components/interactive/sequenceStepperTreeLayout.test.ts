import { describe, expect, it } from 'vitest';

import { TREE_NODE_R, layoutTree, treeEdge, treeProbe } from './sequenceStepperTreeLayout';

/**
 * The tree recipes' geometry (#321), checked exactly rather than measured
 * (`apps/web/CLAUDE.md` §2, "the way out is to not measure"). A node's column
 * is its inorder position, so where it sits follows from that and its depth
 * alone; the strip under the tree has one slot per column, so a value written
 * there lands under the node it came from.
 */

describe('sequenceStepperTreeLayout · the columns', () => {
  it('places a node by its column across and by its depth down', () => {
    const layout = layoutTree(6, 2);
    const root = layout.node(3, 0);
    const left = layout.node(1, 1);
    const leaf = layout.node(0, 2);
    expect(leaf.cx).toBeLessThan(left.cx);
    expect(left.cx).toBeLessThan(root.cx);
    expect(root.cy).toBeLessThan(left.cy);
    expect(left.cy).toBeLessThan(leaf.cy);
    expect(layout.node(3, 2).cx).toBe(root.cx);
  });

  it('puts strip slot k exactly under column k', () => {
    const layout = layoutTree(7, 3);
    expect(layout.strip).toHaveLength(7);
    for (let k = 0; k < 7; k += 1) {
      expect(layout.strip[k]!.cx).toBe(layout.node(k, 0).cx);
      expect(layout.strip[k]!.y).toBeGreaterThan(layout.node(k, 3).cy + TREE_NODE_R);
    }
  });

  it('never lets two nodes of neighbouring columns touch', () => {
    const layout = layoutTree(8, 0);
    for (let k = 0; k + 1 < 8; k += 1) {
      const a = layout.node(k, 0);
      const b = layout.node(k + 1, 0);
      expect(b.cx - a.cx).toBeGreaterThan(2 * TREE_NODE_R + 4);
    }
  });

  it('keeps every node and every strip slot inside the canvas', () => {
    for (let slots = 1; slots <= 8; slots += 1) {
      for (let depth = 0; depth < slots; depth += 1) {
        const layout = layoutTree(slots, depth);
        for (let k = 0; k < slots; k += 1) {
          for (let d = 0; d <= depth; d += 1) {
            const { cx, cy } = layout.node(k, d);
            expect(cx - TREE_NODE_R).toBeGreaterThanOrEqual(0);
            expect(cx + TREE_NODE_R).toBeLessThanOrEqual(layout.width);
            expect(cy - TREE_NODE_R).toBeGreaterThanOrEqual(0);
          }
          const slot = layout.strip[k]!;
          expect(slot.cx - slot.w / 2).toBeGreaterThanOrEqual(0);
          expect(slot.cx + slot.w / 2).toBeLessThanOrEqual(layout.width);
          expect(slot.y + slot.h).toBeLessThanOrEqual(layout.height);
        }
      }
    }
  });

  it('leaves no room for a strip when the operation writes none', () => {
    const bare = layoutTree(6, 2, false);
    expect(bare.strip).toEqual([]);
    expect(bare.height).toBeLessThan(layoutTree(6, 2).height);
    expect(bare.height).toBeGreaterThan(bare.node(0, 2).cy + TREE_NODE_R);
  });

  it('is sized by the run, so the canvas does not jump between frames', () => {
    expect(layoutTree(8, 2).width).toBeGreaterThan(layoutTree(6, 2).width);
    expect(layoutTree(6, 4).height).toBeGreaterThan(layoutTree(6, 2).height);
    expect(layoutTree(6, 2).width).toBe(layoutTree(6, 4).width);
  });
});

describe('sequenceStepperTreeLayout · the edges', () => {
  it('trims an edge to the two rims, so it never runs through a value', () => {
    const layout = layoutTree(3, 1);
    const parent = layout.node(1, 0);
    const child = layout.node(0, 1);
    const e = treeEdge(parent, child);
    expect(Math.hypot(e.x1 - parent.cx, e.y1 - parent.cy)).toBeCloseTo(TREE_NODE_R);
    expect(Math.hypot(e.x2 - child.cx, e.y2 - child.cy)).toBeCloseTo(TREE_NODE_R);
  });
});

describe('sequenceStepperTreeLayout · an empty call', () => {
  it('draws the empty subtree under its parent, on its side, clear of the strip', () => {
    // The deepest level is the tight case: the strip starts right under it.
    const layout = layoutTree(3, 1, true);
    const leaf = layout.node(0, 1);
    const left = treeProbe(leaf, 'left');
    const right = treeProbe(leaf, 'right');
    expect(left.box.x + left.box.w / 2).toBeLessThan(leaf.cx);
    expect(right.box.x + right.box.w / 2).toBeGreaterThan(leaf.cx);
    for (const probe of [left, right]) {
      expect(probe.box.y).toBeGreaterThan(leaf.cy + TREE_NODE_R);
      expect(probe.box.y + probe.box.h).toBeLessThan(layout.strip[0]!.y);
      // The line leaves the parent's rim and stops at the top of the box.
      expect(Math.hypot(probe.line.x1 - leaf.cx, probe.line.y1 - leaf.cy)).toBeCloseTo(
        TREE_NODE_R,
        0,
      );
      expect(probe.line.y2).toBe(probe.box.y);
    }
  });
});

describe('sequenceStepperTreeLayout · an empty call at the edges', () => {
  it('keeps the box inside the canvas under the first and the last column', () => {
    // `null` is written inside the box; written beside it, it ran off the
    // canvas under the first column — seen in the deck, not reasoned about.
    const layout = layoutTree(4, 1, true);
    const first = treeProbe(layout.node(0, 1), 'left');
    const last = treeProbe(layout.node(3, 1), 'right');
    expect(first.box.x).toBeGreaterThanOrEqual(0);
    expect(last.box.x + last.box.w).toBeLessThanOrEqual(layout.width);
  });
});
