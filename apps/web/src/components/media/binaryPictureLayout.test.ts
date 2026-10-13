import { describe, expect, it } from 'vitest';

import { layoutTree } from '../interactive/sequenceStepperTreeLayout';
import { TREE_NODE_R, TREE_SLOT_H } from '../treeGeometry';
import {
  layoutPicture,
  placeTree,
  repeatedValue,
  sequenceWidth,
  type BinaryTreeShape,
  type PictureOptions,
} from './binaryPictureLayout';

/** (3 + 4) * (5 − 1): the expression tree Árboles I threads through its binary act. */
const EXPR: BinaryTreeShape = {
  v: '*',
  l: { v: '+', l: { v: 3 }, r: { v: 4 } },
  r: { v: '−', l: { v: 5 }, r: { v: 1 } },
};

/** A chain hanging to the right: one node per level. */
const CHAIN: BinaryTreeShape = { v: 1, r: { v: 2, r: { v: 3, r: { v: 4 } } } };

const PLAIN: PictureOptions = {};

describe('binaryPictureLayout · placeTree', () => {
  it('puts every node in the column of its inorder position', () => {
    const { nodes } = placeTree(EXPR);
    expect(nodes.map((n) => [n.value, n.column])).toEqual([
      [3, 0],
      ['+', 1],
      [4, 2],
      ['*', 3],
      [5, 4],
      ['−', 5],
      [1, 6],
    ]);
  });

  it('puts every node on the row of its depth', () => {
    const { nodes, depth } = placeTree(EXPR);
    const at = (v: string | number) => nodes.find((n) => n.value === v)!.depth;
    expect([at('*'), at('+'), at('−'), at(3), at(1)]).toEqual([0, 1, 1, 2, 2]);
    expect(depth).toBe(2);
  });

  it('seats a parent between its two subtrees, so no edge crosses another', () => {
    const { nodes } = placeTree(EXPR);
    for (const n of nodes) {
      if (n.left) expect(n.left.column).toBeLessThan(n.column);
      if (n.right) expect(n.right.column).toBeGreaterThan(n.column);
    }
  });

  it('links each node to its parent and its two sides', () => {
    const { root } = placeTree(EXPR);
    expect(root.parent).toBeNull();
    expect(root.left!.value).toBe('+');
    expect(root.left!.parent).toBe(root);
    expect(root.right!.right!.value).toBe(1);
  });
});

describe('binaryPictureLayout · repeatedValue', () => {
  it('names a value that appears twice, which a key could not tell apart', () => {
    expect(repeatedValue(placeTree({ v: 5, l: { v: 5 } }).nodes)).toBe('5');
  });

  it('counts a number and the same digits as a symbol as one value, as the keys do', () => {
    // tones={{ 3: 'focus' }} reaches the component with the key "3", so a 3 and
    // a '3' in one tree would share every tone, badge and note.
    expect(repeatedValue(placeTree({ v: 3, r: { v: '3' } }).nodes)).toBe('3');
  });

  it('is undefined when every value is unique', () => {
    expect(repeatedValue(placeTree(EXPR).nodes)).toBeUndefined();
  });
});

describe('binaryPictureLayout · layoutPicture', () => {
  it('draws with the geometry of the binary-tree recipe, so a figure and the widget beside it match', () => {
    const placed = placeTree(EXPR);
    const canvas = layoutPicture(placed, PLAIN);
    const widget = layoutTree(placed.columns, placed.depth);
    const [three, plus, , times] = placed.nodes;
    expect(canvas.r).toBe(TREE_NODE_R);
    expect(canvas.cx(plus!) - canvas.cx(three!)).toBe(widget.node(1, 0).cx - widget.node(0, 0).cx);
    expect(canvas.cy(three!) - canvas.cy(times!)).toBe(widget.node(0, 2).cy - widget.node(0, 0).cy);
  });

  it('holds every node it draws inside the canvas', () => {
    for (const tree of [EXPR, CHAIN]) {
      const placed = placeTree(tree);
      for (const options of [PLAIN, { compact: true }, { levels: true, ruler: true }]) {
        const canvas = layoutPicture(placed, options);
        for (const n of placed.nodes) {
          expect(canvas.cx(n) - canvas.r).toBeGreaterThanOrEqual(0);
          expect(canvas.cx(n) + canvas.r).toBeLessThanOrEqual(canvas.width);
          expect(canvas.cy(n) - canvas.r).toBeGreaterThanOrEqual(0);
          expect(canvas.cy(n) + canvas.r).toBeLessThanOrEqual(canvas.treeHeight);
        }
      }
    }
  });

  it('narrows the columns and the levels when compact', () => {
    const placed = placeTree(EXPR);
    const wide = layoutPicture(placed, PLAIN);
    const narrow = layoutPicture(placed, { compact: true });
    expect(narrow.width).toBeLessThan(wide.width);
    expect(narrow.treeHeight).toBeLessThan(wide.treeHeight);
  });

  it('gives trees of fewer columns one width under minColumns, and centres them in it', () => {
    const one = placeTree({ v: 8 });
    const four = placeTree({ v: 1, l: { v: 0 }, r: { v: 2, r: { v: 3 } } });
    const canvas = layoutPicture(one, { minColumns: 5 });
    expect(canvas.width).toBe(layoutPicture(four, { minColumns: 5 }).width);
    expect(canvas.cx(one.root)).toBeCloseTo(canvas.width / 2);
    // A tree wider than minColumns takes the room it needs.
    expect(layoutPicture(placeTree(EXPR), { minColumns: 5 }).width).toBeGreaterThan(canvas.width);
  });

  it('widens the canvas for a caption longer than the drawing, and keeps the tree centred in it', () => {
    const placed = placeTree({ v: 8 });
    const bare = layoutPicture(placed, PLAIN);
    const long = 'una leyenda bastante más larga que el dibujo de un solo nodo';
    const captioned = layoutPicture(placed, { caption: long });
    expect(captioned.width).toBeGreaterThan(bare.width);
    expect(captioned.cx(placed.root)).toBeCloseTo(captioned.width / 2);
    expect(captioned.height).toBeGreaterThan(captioned.fullHeight);
  });

  it('keeps room under the tree for the strip, and the strip under the deepest node', () => {
    const placed = placeTree(EXPR);
    const bare = layoutPicture(placed, PLAIN);
    const strip = layoutPicture(placed, { strip: true });
    expect(strip.treeHeight).toBeGreaterThan(bare.treeHeight);
    const deepest = Math.max(...placed.nodes.map((n) => strip.cy(n)));
    expect(strip.stripY).toBeGreaterThan(deepest + strip.r);
  });

  it('keeps one row per level under the tree for the splits, the first where the strip goes', () => {
    const placed = placeTree(EXPR);
    const strip = layoutPicture(placed, { strip: true });
    const splits = layoutPicture(placed, { splits: true });
    expect(splits.splitRowY(0)).toBe(strip.stripY);
    // Every row below the first, one per level, each under the one above.
    for (let d = 1; d <= placed.depth; d += 1) {
      expect(splits.splitRowY(d)).toBeGreaterThan(splits.splitRowY(d - 1) + TREE_SLOT_H);
    }
    expect(splits.treeHeight).toBeGreaterThan(splits.splitRowY(placed.depth) + TREE_SLOT_H);
  });

  it('keeps room for the row of chips under the tree when the sequence is drawn', () => {
    const placed = placeTree(EXPR);
    const width = sequenceWidth(placed.nodes.map((n) => n.value));
    const canvas = layoutPicture(placed, { sequenceWidth: width });
    expect(canvas.fullHeight).toBeGreaterThan(canvas.treeHeight);
    expect(canvas.width).toBeGreaterThanOrEqual(width);
  });
});
