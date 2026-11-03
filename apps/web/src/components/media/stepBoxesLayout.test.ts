import { describe, expect, it } from 'vitest';

import { STEP_GAP, stepBoxesLayout } from './stepBoxesLayout';

describe('stepBoxesLayout', () => {
  it('puts one box after another, a gap for the step between each pair', () => {
    const layout = stepBoxesLayout(3, 120);
    expect(layout.boxX).toHaveLength(3);
    for (let i = 1; i < 3; i++) {
      expect(layout.boxX[i] - layout.boxX[i - 1]).toBe(120 + STEP_GAP);
    }
  });

  it('centres the row on a canvas that holds it', () => {
    const layout = stepBoxesLayout(2, 150);
    const first = layout.boxX[0];
    const end = layout.boxX[1] + layout.boxW;
    expect(first).toBeGreaterThan(0);
    expect(layout.width - end).toBeCloseTo(first);
  });

  it('widens the canvas for a caption longer than the row', () => {
    const short = stepBoxesLayout(2, 120);
    const long = stepBoxesLayout(2, 120, 'x'.repeat(200));
    expect(long.width).toBeGreaterThan(short.width);
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('measures a caption by what it shows, not its backticks', () => {
    const plain = stepBoxesLayout(2, 120, 'x'.repeat(200));
    const coded = stepBoxesLayout(2, 120, '`' + 'x'.repeat(200) + '`');
    expect(coded.width).toBe(plain.width);
  });

  it('draws the boxes of Tablas Hash at the size they were drawn by hand', () => {
    // The numbers Tablas Hash's file-local copy typed by hand before #353: pad 14, boxes of 120, gaps of 150.
    const layout = stepBoxesLayout(3, 120);
    expect(layout.width).toBe(2 * 14 + 3 * 120 + 2 * 150);
    expect(layout.height).toBe(26 + 44 + 12);
  });
});
