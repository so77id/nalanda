import { describe, expect, it } from 'vitest';

import { BOX_H, BOX_W, LINK_W, LIST_GAP, layoutSequence, linkArrow } from './sequenceStepperLayout';

/**
 * The layout is checked here EXACTLY so that jsdom never has to fake a
 * measurement (`apps/web/CLAUDE.md` §2). What the browser still has to
 * confirm is only that the drawing reads well.
 */

describe('layoutSequence', () => {
  it('places array cells edge to edge, in reading order', () => {
    const { boxes } = layoutSequence(4, 'array');
    expect(boxes).toHaveLength(4);
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i]!.x).toBe(boxes[i - 1]!.x + BOX_W);
    }
    expect(boxes.every((b) => b.linkX === null)).toBe(true);
  });

  it('draws the reserved capacity of an array, not only its live cells', () => {
    const full = layoutSequence(4, 'array', 4);
    const spare = layoutSequence(4, 'array', 8);
    expect(spare.boxes).toHaveLength(8);
    expect(spare.width).toBeGreaterThan(full.width);
  });

  it('gives every list node a link field and leaves a gap for the arrow', () => {
    const { boxes } = layoutSequence(3, 'linked-list-singly');
    expect(boxes.every((b) => b.linkX === b.x + BOX_W)).toBe(true);
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.linkX!);
    }
  });

  it('never lets two boxes overlap, in either family', () => {
    for (const recipe of ['array', 'linked-list-singly', 'linked-list-doubly'] as const) {
      const { boxes } = layoutSequence(6, recipe);
      for (let i = 1; i < boxes.length; i += 1) {
        expect(boxes[i]!.x, recipe).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.w);
      }
    }
  });

  it('reserves the ring band only for the circular recipe', () => {
    expect(layoutSequence(3, 'linked-list-circular').ringY).not.toBeNull();
    expect(layoutSequence(3, 'linked-list-singly').ringY).toBeNull();
    expect(layoutSequence(3, 'array').ringY).toBeNull();
    // An empty circular list has no ring to close.
    expect(layoutSequence(0, 'linked-list-circular').ringY).toBeNull();
  });

  it('keeps the canvas big enough to hold everything it drew', () => {
    for (const recipe of ['array', 'linked-list-singly', 'linked-list-circular'] as const) {
      const layout = layoutSequence(5, recipe);
      const last = layout.boxes.at(-1)!;
      expect(layout.width, recipe).toBeGreaterThanOrEqual(last.x + last.w);
      expect(layout.height, recipe).toBeGreaterThanOrEqual(last.y + BOX_H);
    }
  });

  it('survives an empty structure without collapsing to zero', () => {
    const layout = layoutSequence(0, 'linked-list-singly');
    expect(layout.boxes).toHaveLength(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe('linkArrow', () => {
  it('spans the gap from one node to the next', () => {
    const layout = layoutSequence(3, 'linked-list-singly');
    const arrow = linkArrow(layout, 0);
    expect(arrow.x2).toBeGreaterThan(arrow.x1);
    expect(arrow.x2).toBe(layout.boxes[1]!.x);
    expect(arrow.y).toBe(layout.top + BOX_H / 2);
  });

  it('still produces a stub past the last node — that is the null marker', () => {
    const layout = layoutSequence(2, 'linked-list-singly');
    const arrow = linkArrow(layout, 1);
    expect(arrow.x2).toBeGreaterThan(arrow.x1);
    expect(arrow.x2).toBeLessThanOrEqual(layout.width);
  });
});

describe('layoutSequence · the doubly-linked node', () => {
  // Its back link leaves from a FIELD, not from the edge of the value half,
  // so the node reserves three boxes instead of two and everything aimed at
  // "the left edge of the node" has to mean the `prev` field.
  it('reserves a prev field and leaves the value half between the two links', () => {
    const { boxes } = layoutSequence(3, 'linked-list-doubly');
    for (const box of boxes) {
      expect(box.prevX).not.toBeNull();
      expect(box.prevX! + LINK_W).toBe(box.x);
      expect(box.linkX).toBe(box.x + BOX_W);
    }
  });

  it('gives no other recipe a prev field', () => {
    for (const recipe of ['linked-list-singly', 'linked-list-circular', 'array'] as const) {
      for (const box of layoutSequence(3, recipe).boxes) expect(box.prevX).toBeNull();
    }
  });

  it('still leaves the arrow gap between two nodes, measured edge to edge', () => {
    const layout = layoutSequence(3, 'linked-list-doubly');
    const { x1, x2 } = linkArrow(layout, 0);
    expect(x1).toBe(layout.boxes[0]!.linkX! + LINK_W);
    // The arrow lands on the NEXT node's leftmost field, not on its value.
    expect(x2).toBe(layout.boxes[1]!.prevX);
    expect(x2 - x1).toBe(LIST_GAP);
  });

  it('keeps the canvas wide enough for the extra field', () => {
    const doubly = layoutSequence(3, 'linked-list-doubly');
    const singly = layoutSequence(3, 'linked-list-singly');
    expect(doubly.width).toBe(singly.width + 3 * LINK_W);
  });
});
