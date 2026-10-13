import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { NodeGraph, type NodeGraphProps } from './NodeGraph';

/** A node with three children: the drawing that breaks "a lo más dos hijos". */
const THREE_CHILDREN: NodeGraphProps = {
  cols: 3,
  rows: 2,
  nodes: [
    { v: '+', x: 1, y: 0 },
    { v: 3, x: 0, y: 1 },
    { v: 4, x: 1, y: 1 },
    { v: 5, x: 2, y: 1 },
  ],
  edges: [
    ['+', 3],
    ['+', 4],
    ['+', 5],
  ],
  tones: { '+': 'mark' },
  markEdges: [
    ['+', 3],
    ['+', 4],
    ['+', 5],
  ],
  label: 'Un nodo con tres hijos.',
};

/** A node with two parents: the drawing that breaks "exactamente un padre". */
const TWO_PARENTS: NodeGraphProps = {
  cols: 3,
  rows: 2,
  nodes: [
    { v: '+', x: 0.5, y: 0 },
    { v: '*', x: 1.5, y: 0 },
    { v: 4, x: 1, y: 1 },
  ],
  edges: [
    ['+', 4],
    ['*', 4],
  ],
  tones: { 4: 'mark' },
  markEdges: [
    ['+', 4],
    ['*', 4],
  ],
  label: 'Un nodo con dos padres.',
};

const nodeTones = (container: HTMLElement) =>
  Object.fromEntries(
    [...container.querySelectorAll('[data-node]')].map((n) => [
      n.getAttribute('data-value'),
      n.getAttribute('data-tone'),
    ]),
  );

describe('NodeGraph', () => {
  it('is one image, named by its label', () => {
    render(<NodeGraph {...THREE_CHILDREN} />);
    expect(screen.getByRole('img', { name: 'Un nodo con tres hijos.' })).toBeTruthy();
  });

  it('draws every node and every edge it is given, where it is told', () => {
    const { container } = render(<NodeGraph {...TWO_PARENTS} />);
    expect(container.querySelectorAll('[data-node]')).toHaveLength(3);
    expect(
      [...container.querySelectorAll('[data-edge]')].map((e) => e.getAttribute('data-edge')),
    ).toEqual(['+>4', '*>4']);
  });

  it('paints in mark what breaks the rule, nodes and edges alike', () => {
    const { container } = render(<NodeGraph {...TWO_PARENTS} />);
    expect(nodeTones(container)).toEqual({ '+': 'idle', '*': 'idle', 4: 'mark' });
    const marked = [...container.querySelectorAll('[data-edge][data-marked]')];
    expect(marked).toHaveLength(2);
  });

  it('writes the caption under the drawing', () => {
    render(<NodeGraph {...THREE_CHILDREN} caption="tres hijos" />);
    expect(screen.getByText('tres hijos')).toBeTruthy();
  });

  it('draws the same in the book and on a slide', () => {
    const book = render(
      <ModeProvider mode="book">
        <NodeGraph {...THREE_CHILDREN} />
      </ModeProvider>,
    ).container.innerHTML;
    const slide = render(
      <ModeProvider mode="presentation">
        <NodeGraph {...THREE_CHILDREN} />
      </ModeProvider>,
    ).container.innerHTML;
    expect(slide).toBe(book);
  });

  it('tells the author when the label is missing, and draws nothing', () => {
    const { container } = render(<NodeGraph {...THREE_CHILDREN} label="" />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('tells the author when an edge names a node that is not drawn', () => {
    const { container } = render(
      <NodeGraph {...THREE_CHILDREN} edges={[['+', 9]]} markEdges={[]} />,
    );
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});
