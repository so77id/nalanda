import { describe, expect, it } from 'vitest';

import { HASH_CELL_H, HASH_NODE_KEY_H, HASH_NODE_LINK_H } from '../hashGeometry';
import { CELL_H, NODE_KEY_H, NODE_LINK_H } from '../interactive/sequenceStepperHashLayout';
import { CHAIN_TABLE_SIZES, CHAIN_VALUE_H, chainTableLayout } from './chainTableLayout';

const TABLE = [['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []];

describe('chainTableLayout', () => {
  it('draws a cell and the fields of a node at the heights the widget draws them', () => {
    const layout = chainTableLayout(TABLE);
    expect(layout.cellH).toBe(CELL_H);
    expect(layout.keyH).toBe(NODE_KEY_H);
    expect(layout.linkH).toBe(NODE_LINK_H);
    expect(layout.nodeH).toBe(NODE_KEY_H + NODE_LINK_H);
    expect([CELL_H, NODE_KEY_H, NODE_LINK_H]).toEqual([
      HASH_CELL_H,
      HASH_NODE_KEY_H,
      HASH_NODE_LINK_H,
    ]);
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
    // 23-edd-tablas-hash.mdx's file-local Chains: pad 12, pitch 78, gap 18.
    const layout = chainTableLayout(TABLE);
    expect(layout.width).toBe(2 * 12 + 7 * 78);
    expect(layout.height).toBe(layout.nodeY(2) - 18 + 18 + 6);
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
