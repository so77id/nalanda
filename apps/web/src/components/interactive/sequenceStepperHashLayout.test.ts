import { describe, expect, it } from 'vitest';

import { layoutHash, layoutProbe, type HashBox } from './sequenceStepperHashLayout';

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

describe('sequenceStepperHashLayout · resize draws old beside table', () => {
  it('puts old to the left of table, both named, neither touching the other', () => {
    const layout = layoutHash(7, 2, 3);
    const old = layout.old!;
    const lastOld = old.cell(2);
    expect(lastOld.x + lastOld.w).toBeLessThan(layout.name.x - 30);
    expect(old.name.x).toBeGreaterThan(30);
    expect(layout.cell(6).x + layout.cell(6).w).toBeLessThanOrEqual(layout.width);
    for (let i = 0; i < 3; i += 1) {
      expect(old.cell(i).y).toBe(layout.cell(0).y);
      expect(inside(old.node(i, 1), layout.width, layout.height)).toBe(true);
    }
  });

  it('keeps the strip of an ordinary run where it was, unnamed and alone', () => {
    const plain = layoutHash(7, 2);
    expect(plain.old).toBeNull();
    expect(plain.cell(0).x).toBe(14);
  });
});

describe('sequenceStepperHashLayout · the probing table', () => {
  it('draws keys and deleted as two contiguous strips, one cell of each per position', () => {
    const layout = layoutProbe(11);
    for (let i = 0; i < 11; i += 1) {
      const cell = layout.cell(i);
      const mark = layout.mark(i);
      if (i > 0) expect(cell.x).toBe(layout.cell(i - 1).x + layout.cell(i - 1).w);
      expect(mark.x).toBe(cell.x);
      expect(mark.w).toBe(cell.w);
      expect(mark.y).toBeGreaterThanOrEqual(cell.y + cell.h);
    }
  });

  it('keeps the chip over its cell, the index between them, and the cursor under deleted', () => {
    const layout = layoutProbe(7);
    const band = layout.band(3);
    expect(band.cx).toBe(layout.cell(3).cx);
    expect(band.y + band.h).toBeLessThan(layout.index(3).y - 8);
    expect(layout.cursor(3).tip).toBeGreaterThan(layout.mark(3).y + layout.mark(3).h);
    expect(layout.cursor(3).label).toBeLessThan(layout.height);
  });

  it('names the two strips to their left, inside the canvas', () => {
    const layout = layoutProbe(5);
    expect(layout.names.keys.x).toBeLessThan(layout.cell(0).x);
    expect(layout.names.deleted.x).toBeLessThan(layout.mark(0).x);
    expect(layout.names.keys.x).toBeGreaterThan(40);
    expect(inside(layout.cell(4), layout.width, layout.height)).toBe(true);
  });
});

describe('layoutHash · a resize too wide to draw side by side', () => {
  // `grow` (#326 review) resizes 5 → 11: sixteen positions in a row would
  // shrink every node past reading, so the two tables are stacked — `old` on
  // top, where the table was, and the new one under it.
  it('stacks old over the table once the two pass twelve positions', () => {
    const stacked = layoutHash(11, 2, 5);
    expect(stacked.below).not.toBeNull();
    const below = stacked.below!;
    // The table's strip starts under the longest list of old, null included.
    expect(below.band(0).y).toBeGreaterThan(stacked.old!.nullAt(0, 2).y);
    // Both strips share the left edge, so a key's column reads straight down.
    expect(below.cell(0).x).toBe(stacked.old!.cell(0).x);
    expect(stacked.width).toBeLessThan(layoutHash(16, 2).width);
    expect(stacked.height).toBeGreaterThan(below.nullAt(0, 2).y);
  });

  it('keeps the bypass clear of the next column at the narrower pitch', () => {
    // On the growing slide «Teo» enters position 4 and «Eva» sits in 5: a
    // link down the bypass ran along her border (#331 review, COR-8).
    const below = layoutHash(11, 2, 5).below!;
    for (let i = 0; i < 10; i += 1) {
      expect(below.bypassX(i)).toBeGreaterThan(below.node(i, 0).x + below.node(i, 0).w);
      expect(below.bypassX(i)).toBeLessThan(below.node(i + 1, 0).x);
    }
  });

  it('keeps a resize that fits side by side as it was', () => {
    const side = layoutHash(7, 2, 3);
    expect(side.below).toBeNull();
    expect(side.cell(0).x).toBeGreaterThan(side.old!.cell(2).x);
  });
});

describe('layoutProbe · a resize, the old arrays over the new ones', () => {
  it('stacks oldKeys and oldDeleted over keys and deleted, with room for the longer names', () => {
    const stacked = layoutProbe(11, 5);
    expect(stacked.old).not.toBeNull();
    expect(stacked.below).not.toBeNull();
    const old = stacked.old!;
    const below = stacked.below!;
    expect(below.band(0).y).toBeGreaterThan(old.cursor(0).label);
    expect(below.cell(0).x).toBe(old.cell(0).x);
    // `oldDeleted` is ten characters at 12px: its name ends left of the strip.
    expect(old.names.deleted.x - 10 * 7.5).toBeGreaterThan(0);
    expect(stacked.height).toBeGreaterThan(below.cursor(0).label);
  });

  it('draws one table, unchanged, when there is no resize', () => {
    const one = layoutProbe(11);
    expect(one.old).toBeNull();
    expect(one.below).toBeNull();
  });
});
