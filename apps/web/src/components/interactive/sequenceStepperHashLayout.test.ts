import { describe, expect, it } from 'vitest';

import { layoutHash, type HashBox } from './sequenceStepperHashLayout';

/**
 * The hash view paints only what this module computes, so the geometry is
 * pinned here and jsdom never fakes a measurement (`apps/web/CLAUDE.md` §2).
 */

const inside = (b: HashBox, w: number, h: number) =>
  b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h;

const overlap = (a: HashBox, b: HashBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('sequenceStepperHashLayout', () => {
  // An array is contiguous memory — the invariant the unit teaches first — and
  // the widget draws every array with its cells touching (`dynamic-array`).
  // Cells with gaps between them read as loose boxes, which is how NODES are
  // drawn (Miguel's review of S1, #326).
  it('draws table as one contiguous strip: every cell on the same row, flush with the next', () => {
    const layout = layoutHash(7, 3);
    for (let i = 0; i < 7; i += 1) {
      expect(layout.cell(i).y).toBe(layout.cell(0).y);
      if (i > 0) {
        expect(layout.cell(i).x, String(i)).toBe(layout.cell(i - 1).x + layout.cell(i - 1).w);
        expect(overlap(layout.cell(i - 1), layout.cell(i)), String(i)).toBe(false);
      }
    }
  });

  it('hangs each list in its own column, every node under the one before it', () => {
    const layout = layoutHash(7, 3);
    for (let i = 0; i < 7; i += 1) {
      expect(layout.node(i, 0).y).toBeGreaterThan(layout.cell(i).y + layout.cell(i).h);
      for (let k = 1; k < 3; k += 1) {
        expect(layout.node(i, k).cx).toBe(layout.cell(i).cx);
        expect(layout.node(i, k).y).toBeGreaterThan(
          layout.node(i, k - 1).y + layout.node(i, k - 1).h,
        );
      }
      // A list never reaches the next column, nor the bypass of its own.
      if (i < 6) expect(overlap(layout.node(i, 0), layout.node(i + 1, 0))).toBe(false);
      expect(layout.bypassX(i)).toBeGreaterThan(layout.node(i, 0).x + layout.node(i, 0).w);
      if (i < 6) expect(layout.bypassX(i)).toBeLessThan(layout.node(i + 1, 0).x);
    }
  });

  it('keeps the band above the strip, clear of the index it sits over', () => {
    const layout = layoutHash(7, 1);
    const band = layout.band(3);
    expect(band.cx).toBe(layout.cell(3).cx);
    expect(band.y + band.h).toBeLessThan(layout.index(3).y - 8);
    expect(layout.index(3).y).toBeLessThan(layout.cell(3).y);
  });

  it('holds everything it draws, the longest list and its null included', () => {
    for (const [buckets, longest] of [
      [2, 1],
      [7, 3],
      [11, 4],
    ] as const) {
      const layout = layoutHash(buckets, longest);
      for (let i = 0; i < buckets; i += 1) {
        expect(inside(layout.cell(i), layout.width, layout.height)).toBe(true);
        expect(inside(layout.band(i), layout.width, layout.height)).toBe(true);
        expect(inside(layout.node(i, longest - 1), layout.width, layout.height)).toBe(true);
        expect(layout.nullAt(i, longest).y).toBeLessThan(layout.height);
      }
    }
  });

  it('writes the null of an empty position inside its cell', () => {
    const layout = layoutHash(7, 2);
    const cell = layout.cell(2);
    const at = layout.nullAt(2, 0);
    expect(at.y).toBeGreaterThan(cell.y);
    expect(at.y).toBeLessThan(cell.y + cell.h);
  });
});
