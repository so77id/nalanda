import { describe, expect, it } from 'vitest';

import { layoutHash, NODE_KEY_H } from '../interactive/sequenceStepperHashLayout';
import { CHAIN_TABLE_SIZES, CHAIN_VALUE_H, chainTableLayout } from './chainTableLayout';

const TABLE = [['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []];

describe('chainTableLayout', () => {
  it('draws a cell and a node at the heights the widget draws them', () => {
    const widget = layoutHash(TABLE.length, 2);
    const layout = chainTableLayout(TABLE);
    expect(layout.cellH).toBe(widget.cell(0).h);
    expect(layout.nodeH).toBe(widget.node(0, 0).h);
    expect(layout.keyH).toBe(NODE_KEY_H);
  });

  it('draws the strip contiguous, one pitch per position', () => {
    const layout = chainTableLayout(TABLE);
    for (let i = 1; i < TABLE.length; i++) {
      expect(layout.cellX(i) - layout.cellX(i - 1)).toBe(layout.pitch);
    }
    expect(layout.stripW).toBe(TABLE.length * layout.pitch);
  });

  it('hangs each list down from its cell, a node under the other', () => {
    const layout = chainTableLayout(TABLE);
    expect(layout.nodeY(0)).toBeGreaterThan(layout.cellY + layout.cellH);
    expect(layout.nodeY(1) - layout.nodeY(0)).toBeGreaterThan(layout.nodeH);
  });

  it('keeps every node inside its own column', () => {
    for (const size of ['name', 'rut'] as const) {
      const { nodeW, pitch } = CHAIN_TABLE_SIZES[size];
      expect(nodeW).toBeLessThan(pitch);
    }
  });

  it('draws Tablas Hash tables at the size they were drawn by hand', () => {
    // The numbers Tablas Hash's file-local Chains typed by hand before #353: pad 12, pitch 78, gap 18.
    const layout = chainTableLayout(TABLE);
    expect(layout.width).toBe(2 * 12 + 7 * 78);
    expect(layout.height).toBe(layout.nodeY(2) - 18 + 18 + 6);
  });

  it('draws Set y Map tables at the size they were drawn by hand', () => {
    // The numbers Set y Map's file-local ChainTable typed by hand before #353:
    // pitch 108, nodes of 98, a key field of 24 in a 12.5 face, a value band of 20.
    expect(CHAIN_TABLE_SIZES.rut).toEqual({ pitch: 108, nodeW: 98, keyH: 24, keyFont: 12.5 });
    expect(CHAIN_VALUE_H).toBe(20);
    const map = chainTableLayout(TABLE, { size: 'rut', values: true });
    expect(map.width).toBe(2 * 12 + 7 * 108);
    expect(map.nodeH).toBe(24 + 20 + 12);
  });

  it("starts a reference in the middle of its node's link field", () => {
    const layout = chainTableLayout(TABLE);
    expect(layout.linkY(0)).toBe(layout.nodeY(0) + layout.keyH + layout.linkH / 2);
    const map = chainTableLayout(TABLE, { values: true });
    expect(map.linkY(0) - layout.linkY(0)).toBe(CHAIN_VALUE_H);
  });

  it('runs the link that skips a node from the reference that pointed at it', () => {
    // Position 2 of TABLE sits at x 207: the strip starts at 12, each pitch is 78.
    const layout = chainTableLayout(TABLE);
    expect(layout.cx(2)).toBe(207);
    // The first node: from the middle of the cell, out past the column, down onto the node after it.
    expect(layout.bypass(2, 2, 0)).toEqual({
      line: 'M 207 41 H 247 V 134 H 242',
      head: 'M 243 130 L 236 134 L 243 138 z',
    });
    // The last node: from the reference of the one before it, down beside its null.
    expect(layout.bypass(2, 2, 1)).toEqual({
      line: 'M 207 102 H 247 V 169 H 227',
      head: 'M 228 165 L 221 169 L 228 173 z',
    });
  });

  it('draws a window of positions with room for the «…» on each side', () => {
    const whole = chainTableLayout(TABLE);
    const part = chainTableLayout(TABLE, { window: [1, 3] });
    expect([part.lo, part.hi]).toEqual([1, 3]);
    expect(part.stripW).toBe(3 * whole.pitch);
    expect(part.width).toBe(2 * 12 + part.stripW + 40);
    expect(part.cellX(1)).toBe(part.left);
  });

  it('gives a RUT a wider node, and a map node its value band', () => {
    const name = chainTableLayout(TABLE);
    const rut = chainTableLayout(TABLE, { size: 'rut' });
    const map = chainTableLayout(TABLE, { size: 'rut', values: true });
    expect(rut.nodeW).toBeGreaterThan(name.nodeW);
    expect(map.nodeH - rut.nodeH).toBe(CHAIN_VALUE_H);
  });

  it('widens the canvas for a caption, counting what it shows and not its backticks', () => {
    const plain = chainTableLayout([['a']], { caption: 'x'.repeat(120) });
    const coded = chainTableLayout([['a']], { caption: '`' + 'x'.repeat(120) + '`' });
    expect(plain.width).toBeGreaterThan(chainTableLayout([['a']]).width);
    expect(coded.width).toBe(plain.width);
  });
});
