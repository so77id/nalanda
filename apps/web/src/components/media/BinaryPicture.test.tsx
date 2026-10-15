import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { BinaryPicture } from './BinaryPicture';
import { TREE_LEVEL_H } from '../treeGeometry';
import type { BinaryTreeShape } from './binaryPictureLayout';

/** (3 + 4) * (5 − 1), the expression tree Árboles I threads through its binary act. */
const EXPR: BinaryTreeShape = {
  v: '*',
  l: { v: '+', l: { v: 3 }, r: { v: 4 } },
  r: { v: '−', l: { v: 5 }, r: { v: 1 } },
};

const LABEL = 'El árbol de la expresión (3 + 4) por (5 − 1).';

const nodesOf = (container: HTMLElement) => [...container.querySelectorAll('[data-node]')];
const valuesOf = (container: HTMLElement) =>
  nodesOf(container).map((n) => n.getAttribute('data-value'));

describe('BinaryPicture', () => {
  it('is one image, named by its label', () => {
    render(<BinaryPicture tree={EXPR} label={LABEL} />);
    expect(screen.getByRole('img', { name: LABEL })).toBeTruthy();
  });

  it('draws every node once, in the column of its inorder position', () => {
    const { container } = render(<BinaryPicture tree={EXPR} label={LABEL} />);
    const columns = Object.fromEntries(
      nodesOf(container).map((n) => [n.getAttribute('data-value'), n.getAttribute('data-column')]),
    );
    expect(columns).toEqual({
      '3': '0',
      '+': '1',
      '4': '2',
      '*': '3',
      '5': '4',
      '−': '5',
      '1': '6',
    });
  });

  it('paints each node in the tone it is given, keyed by its value', () => {
    const { container } = render(
      <BinaryPicture tree={EXPR} tones={{ '+': 'focus', 5: 'mark' }} label={LABEL} />,
    );
    const tone = (v: string) =>
      nodesOf(container)
        .find((n) => n.getAttribute('data-value') === v)!
        .getAttribute('data-tone');
    expect([tone('+'), tone('5'), tone('*')]).toEqual(['focus', 'mark', 'idle']);
  });

  it('keeps a hidden node out of the drawing, with every edge that reaches it', () => {
    const { container } = render(
      <BinaryPicture tree={EXPR} tones={{ '*': 'hidden' }} label={LABEL} />,
    );
    expect(valuesOf(container)).not.toContain('*');
    // The two edges from the root are gone; the four under it stay.
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(4);
  });

  it('says root = null when every node is hidden, or what the author asks it to say', () => {
    const allHidden = {
      '*': 'hidden',
      '+': 'hidden',
      '−': 'hidden',
      3: 'hidden',
      4: 'hidden',
      5: 'hidden',
      1: 'hidden',
    } as const;
    const { container, rerender } = render(
      <BinaryPicture tree={EXPR} tones={allHidden} label={LABEL} />,
    );
    expect(container.textContent).toContain('root = null');
    rerender(<BinaryPicture tree={EXPR} tones={allHidden} emptyNote="" label={LABEL} />);
    expect(container.textContent).not.toContain('root = null');
  });

  it('numbers the visits in the order asked for, and stops at until', () => {
    const order = (container: HTMLElement) =>
      [...container.querySelectorAll('[data-visit]')]
        .sort((a, b) => Number(a.getAttribute('data-visit')) - Number(b.getAttribute('data-visit')))
        .map((n) => n.getAttribute('data-value'));
    const { container, rerender } = render(
      <BinaryPicture tree={EXPR} visits="pre" label={LABEL} />,
    );
    expect(order(container)).toEqual(['*', '+', '3', '4', '−', '5', '1']);
    rerender(<BinaryPicture tree={EXPR} visits="post" label={LABEL} />);
    expect(order(container)).toEqual(['3', '4', '+', '5', '1', '−', '*']);
    rerender(<BinaryPicture tree={EXPR} visits="pre" until={4} label={LABEL} />);
    expect(order(container)).toEqual(['*', '+', '3', '4']);
  });

  it('writes the visit order under the tree as a row of chips', () => {
    const { container } = render(<BinaryPicture tree={EXPR} visits="in" sequence label={LABEL} />);
    const chips = [...container.querySelectorAll('[data-chip]')].map((c) =>
      c.getAttribute('data-value'),
    );
    expect(chips).toEqual(['3', '+', '4', '*', '5', '−', '1']);
  });

  it('writes the inorder in the strip, each value under its own node', () => {
    const { container } = render(<BinaryPicture tree={EXPR} strip label={LABEL} />);
    const slots = [...container.querySelectorAll('[data-slot]')];
    expect(slots.map((s) => s.getAttribute('data-value'))).toEqual([
      '3',
      '+',
      '4',
      '*',
      '5',
      '−',
      '1',
    ]);
    expect(slots.map((s) => s.getAttribute('data-column'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('splits a binary search level by level: each node over the stretch it halves, in its colour', () => {
    // The decision tree of a binary search over 2, 4, …, 14.
    const EVENS: BinaryTreeShape = {
      v: 8,
      l: { v: 4, l: { v: 2 }, r: { v: 6 } },
      r: { v: 12, l: { v: 10 }, r: { v: 14 } },
    };
    const { container } = render(
      <BinaryPicture tree={EVENS} splits label="Las divisiones de la búsqueda binaria." />,
    );
    const stretches = [...container.querySelectorAll('[data-split]')].map((g) =>
      ['data-value', 'data-depth', 'data-from', 'data-to', 'data-tone']
        .map((a) => g.getAttribute(a))
        .join(' '),
    );
    expect(stretches).toEqual([
      '8 0 0 6 accent',
      '4 1 0 2 mark',
      '12 1 4 6 mark',
      '2 2 0 0 keep',
      '6 2 2 2 keep',
      '10 2 4 4 keep',
      '14 2 6 6 keep',
    ]);
    // Every node takes its level's colour, so it reads as the middle of its stretch.
    const tone = (v: string) =>
      nodesOf(container)
        .find((n) => n.getAttribute('data-value') === v)!
        .getAttribute('data-tone');
    expect([tone('8'), tone('12'), tone('6')]).toEqual(['accent', 'mark', 'keep']);
  });

  it('lets a tone the author writes win over the colour of the level', () => {
    const EVENS: BinaryTreeShape = { v: 8, l: { v: 4 }, r: { v: 12 } };
    const { container } = render(
      <BinaryPicture tree={EVENS} splits tones={{ 4: 'done' }} label="Tres valores." />,
    );
    const four = nodesOf(container).find((n) => n.getAttribute('data-value') === '4')!;
    expect(four.getAttribute('data-tone')).toBe('done');
  });

  it('draws an empty call as a box with null in it, under the side it landed on', () => {
    const { container } = render(
      <BinaryPicture tree={EXPR} path={['*', '+', 3]} probe={{ at: 3, side: 'l' }} label={LABEL} />,
    );
    const probe = container.querySelector('[data-probe]');
    expect(probe?.getAttribute('data-probe')).toBe('3-l');
    expect(probe?.textContent).toBe('null');
    expect(container.querySelectorAll('[data-edge][data-lit]')).toHaveLength(2);
  });

  it('writes the value a search is looking for, and the caption under the drawing', () => {
    render(<BinaryPicture tree={EXPR} seek={5} caption="buscar el 5" label={LABEL} />);
    expect(screen.getByText('se busca el 5')).toBeTruthy();
    expect(screen.getByText('buscar el 5')).toBeTruthy();
  });

  it('draws a named subtree as a triangle, in its own column', () => {
    // The generic rotation: p over q and C, q over A and B.
    const { container } = render(
      <BinaryPicture
        tree={{ v: 'p', l: { v: 'q', l: { v: 'A' }, r: { v: 'B' } }, r: { v: 'C' } }}
        subtrees={['A', 'B', 'C']}
        strip
        holes
        label="Una rotación genérica."
      />,
    );
    // A triangle is a whole subtree: no empty children drawn under it.
    expect(container.querySelectorAll('[data-hole]')).toHaveLength(0);
    const triangles = [...container.querySelectorAll('[data-subtree]')];
    expect(triangles.map((t) => t.getAttribute('data-value'))).toEqual(['A', 'B', 'C']);
    expect(triangles.every((t) => t.querySelector('path'))).toBe(true);
    expect(triangles.some((t) => t.querySelector('circle'))).toBe(false);
    const slots = [...container.querySelectorAll('[data-slot]')].map((s) =>
      s.getAttribute('data-value'),
    );
    expect(slots).toEqual(['A', 'q', 'B', 'p', 'C']);
  });

  it('draws a turn as a curved arrow over the edge it rotates, clockwise to the right', () => {
    const { container } = render(
      <BinaryPicture
        tree={{ v: 'p', l: { v: 'q', l: { v: 'A' }, r: { v: 'B' } }, r: { v: 'C' } }}
        subtrees={['A', 'B', 'C']}
        turn={{ at: 'p', dir: 'right' }}
        label="Una rotación a la derecha en p."
      />,
    );
    const turn = container.querySelector('[data-turn]');
    expect(turn?.getAttribute('data-turn')).toBe('right');
    // The edge it turns: p and its LEFT child, the one that goes up.
    expect(turn?.getAttribute('data-edge')).toBe('p-q');
    expect(turn?.querySelector('path')).toBeTruthy();
    expect(turn?.querySelector('polygon')).toBeTruthy();
  });

  it('turns to the left over the edge to the right child, counterclockwise', () => {
    const { container } = render(
      <BinaryPicture
        tree={{ v: 'p', l: { v: 'A' }, r: { v: 'q', l: { v: 'B' }, r: { v: 'C' } } }}
        subtrees={['A', 'B', 'C']}
        turn={{ at: 'p', dir: 'left' }}
        label="Una rotación a la izquierda en p."
      />,
    );
    const turn = container.querySelector('[data-turn]');
    expect(turn?.getAttribute('data-turn')).toBe('left');
    expect(turn?.getAttribute('data-edge')).toBe('p-q');
  });

  it('tells the author when a turn has no child to bring up', () => {
    // A right rotation lifts the left child: with none, there is nothing to turn.
    const { container } = render(
      <BinaryPicture
        tree={{ v: 'p', r: { v: 'q' } }}
        turn={{ at: 'p', dir: 'right' }}
        label="Un nodo sin hijo izquierdo."
      />,
    );
    expect(container.textContent).toContain('<BinaryPicture>');
    expect(container.textContent).toContain('hijo izquierdo');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws a tall subtree a level deeper, and makes room for it only past the deepest level', () => {
    const before = { v: 'p', l: { v: 'q', l: { v: 'A' }, r: { v: 'B' } }, r: { v: 'C' } };
    const after = { v: 'q', l: { v: 'A' }, r: { v: 'p', l: { v: 'B' }, r: { v: 'C' } } };
    const height = (tree: BinaryTreeShape, tall: string[]) => {
      const { container } = render(
        <BinaryPicture
          tree={tree}
          subtrees={['A', 'B', 'C']}
          tall={tall}
          label="Una rotación con un subárbol más alto."
        />,
      );
      const svg = container.querySelector('svg')!;
      return {
        h: Number(svg.getAttribute('viewBox')!.split(' ')[3]),
        tall: [...container.querySelectorAll('[data-tall]')].map((t) =>
          t.getAttribute('data-value'),
        ),
      };
    };
    // Before a right rotation, A is the deepest thing drawn: a level more.
    expect(height(before, ['A']).h - height(before, []).h).toBe(TREE_LEVEL_H);
    expect(height(before, ['A']).tall).toEqual(['A']);
    // After it, A went up a level and reaches only as deep as B and C.
    expect(height(after, ['A']).h).toBe(height(after, []).h);
  });

  it('draws the levels down to where a tall subtree reaches', () => {
    const { container } = render(
      <BinaryPicture
        tree={{ v: 'p', l: { v: 'q', l: { v: 'A' }, r: { v: 'B' } }, r: { v: 'C' } }}
        subtrees={['A', 'B', 'C']}
        tall={['A']}
        levels
        label="Una rotación con los niveles marcados."
      />,
    );
    const levels = [...container.querySelectorAll('text')]
      .map((t) => t.textContent)
      .filter((t) => t?.startsWith('nivel'));
    // p on 0, q and C on 1, B on 2, and A reaching down to 3.
    expect(levels).toEqual(['nivel 0', 'nivel 1', 'nivel 2', 'nivel 3']);
  });

  it('tells the author when a tall value is not a subtree', () => {
    const { container } = render(
      <BinaryPicture tree={{ v: 'p', l: { v: 'q' } }} tall={['q']} label="Un nodo marcado alto." />,
    );
    expect(container.textContent).toContain('<BinaryPicture>');
    expect(container.textContent).toContain('subtrees');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('paints the accent tone, the one for what is being moved', () => {
    const { container } = render(
      <BinaryPicture tree={EXPR} tones={{ '+': 'accent' }} label={LABEL} />,
    );
    expect(container.querySelector('[data-value="+"]')?.getAttribute('data-tone')).toBe('accent');
  });

  it('draws the same in the book and on a slide', () => {
    const inMode = (mode: 'book' | 'presentation') =>
      render(
        <ModeProvider mode={mode}>
          <BinaryPicture tree={EXPR} visits="pre" holes strip label={LABEL} />
        </ModeProvider>,
      ).container.innerHTML;
    expect(inMode('presentation')).toBe(inMode('book'));
  });

  it('tells the author when the label is missing, and draws nothing', () => {
    // MDX is not typechecked: an image with no name is invisible to a screen
    // reader, and only the author can fix it.
    const props = { tree: EXPR } as unknown as Parameters<typeof BinaryPicture>[0];
    const { container } = render(<BinaryPicture {...props} />);
    expect(container.textContent).toContain('<BinaryPicture>');
    expect(container.textContent).toMatch(/label/);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('tells the author when a value repeats, since tones and notes are keyed by value', () => {
    const { container } = render(
      <BinaryPicture
        tree={{ v: 5, l: { v: 3 }, r: { v: 3 } }}
        label="Un árbol con un 3 repetido."
      />,
    );
    expect(container.textContent).toContain('<BinaryPicture>');
    expect(container.textContent).toContain('3');
    expect(container.querySelector('svg')).toBeNull();
  });
});
