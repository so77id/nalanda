import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { NodeGraph, type NodeGraphProps } from './NodeGraph';

/** Two triangles that share C: a walk A, B, C, D, E, C passes C twice. */
const BOWTIE: NodeGraphProps = {
  cols: 3,
  rows: 3,
  nodes: [
    { v: 'A', x: 0, y: 0 },
    { v: 'B', x: 0, y: 2 },
    { v: 'C', x: 1, y: 1 },
    { v: 'D', x: 2, y: 0 },
    { v: 'E', x: 2, y: 2 },
  ],
  edges: [
    ['A', 'B'],
    ['A', 'C'],
    ['B', 'C'],
    ['C', 'D'],
    ['C', 'E'],
    ['D', 'E'],
  ],
  label: 'Dos triángulos que comparten C.',
};

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

/** Who follows whom: A and B follow each other, and C follows B. */
const FOLLOWS: NodeGraphProps = {
  cols: 3,
  rows: 2,
  directed: true,
  nodes: [
    { v: 'A', x: 0, y: 0 },
    { v: 'B', x: 2, y: 0 },
    { v: 'C', x: 1, y: 1 },
  ],
  edges: [
    ['A', 'B'],
    ['B', 'A'],
    ['C', 'B'],
  ],
  label: 'Quién sigue a quién.',
};

/** Three corners and the minutes between them. */
const STREETS: NodeGraphProps = {
  cols: 3,
  rows: 2,
  nodes: [
    { v: 'A', x: 0, y: 0 },
    { v: 'B', x: 2, y: 0 },
    { v: 'C', x: 1, y: 1 },
  ],
  edges: [
    ['A', 'B', 7],
    ['A', 'C', 3],
    ['C', 'B', 2],
  ],
  label: 'Tres esquinas y sus tiempos.',
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

  it('draws an arrowhead on every edge of a directed graph, and none otherwise', () => {
    const directed = render(<NodeGraph {...FOLLOWS} />).container;
    expect(directed.querySelectorAll('[data-edge] polygon')).toHaveLength(3);
    const plain = render(<NodeGraph {...FOLLOWS} directed={false} />).container;
    expect(plain.querySelectorAll('[data-edge] polygon')).toHaveLength(0);
  });

  it('writes each weight on its edge', () => {
    const { container } = render(<NodeGraph {...STREETS} />);
    expect([...container.querySelectorAll('[data-weight]')].map((w) => w.textContent)).toEqual([
      '7',
      '3',
      '2',
    ]);
  });

  it('marks an undirected edge whichever order the author names it in', () => {
    const { container } = render(<NodeGraph {...STREETS} markEdges={[['C', 'A']]} />);
    const marked = [...container.querySelectorAll('[data-edge][data-marked]')];
    expect(marked.map((e) => e.getAttribute('data-edge'))).toEqual(['A>C']);
  });

  it('in a directed graph, marks only the edge in the order named', () => {
    const { container } = render(<NodeGraph {...FOLLOWS} markEdges={[['B', 'A']]} />);
    const marked = [...container.querySelectorAll('[data-edge][data-marked]')];
    expect(marked.map((e) => e.getAttribute('data-edge'))).toEqual(['B>A']);
  });

  it('paints a node in the tone it is given', () => {
    const { container } = render(
      <NodeGraph {...STREETS} tones={{ A: 'mark', B: 'flag', C: 'keep' }} />,
    );
    expect(nodeTones(container)).toEqual({ A: 'mark', B: 'flag', C: 'keep' });
  });

  it('writes a note beside its node', () => {
    const { container } = render(<NodeGraph {...STREETS} notes={{ A: 2 }} />);
    const notes = [...container.querySelectorAll('[data-note]')];
    expect(notes.map((n) => n.textContent)).toEqual(['2']);
    expect(notes[0].closest('[data-node]')!.getAttribute('data-value')).toBe('A');
  });

  it('draws a short label in a circle and a name in a pill', () => {
    const { container } = render(
      <NodeGraph
        cols={4}
        rows={1}
        nodes={[
          { v: 'A', x: 0, y: 0 },
          { v: 'Beto', x: 2, y: 0 },
        ]}
        edges={[['A', 'Beto']]}
        label="Dos personas."
      />,
    );
    const shapes = Object.fromEntries(
      [...container.querySelectorAll('[data-node]')].map((n) => [
        n.getAttribute('data-value'),
        n.getAttribute('data-shape'),
      ]),
    );
    expect(shapes).toEqual({ A: 'circle', Beto: 'pill' });
  });

  it('numbers the edges of a walk by its steps, and marks them', () => {
    const { container } = render(<NodeGraph {...BOWTIE} walk={['A', 'B', 'C', 'D', 'E', 'C']} />);
    const steps = [...container.querySelectorAll('[data-step]')].map((g) => [
      g.getAttribute('data-step'),
      g.getAttribute('data-of'),
    ]);
    expect(steps).toEqual([
      ['1', '0'],
      ['2', '2'],
      ['3', '3'],
      ['4', '5'],
      ['5', '4'],
    ]);
    expect(container.querySelectorAll('[data-edge][data-marked]')).toHaveLength(5);
  });

  it('walks parallel edges one after the other', () => {
    const { container } = render(
      <NodeGraph
        {...BOWTIE}
        edges={[
          ['A', 'B'],
          ['A', 'B'],
        ]}
        walk={['A', 'B', 'A']}
      />,
    );
    expect(
      [...container.querySelectorAll('[data-step]')].map((g) => g.getAttribute('data-of')),
    ).toEqual(['0', '1']);
  });

  it('tells the author when a walk steps where no edge goes', () => {
    const { container } = render(<NodeGraph {...BOWTIE} walk={['A', 'D']} />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when a walk repeats an edge', () => {
    const { container } = render(
      <NodeGraph {...BOWTIE} edges={[['A', 'B']]} walk={['A', 'B', 'A']} />,
    );
    expect(container.querySelector('[data-authoring-error]')?.textContent).toMatch(
      /repite una arista/,
    );
  });

  it('tells the author when two nodes share a place', () => {
    const nodes = [...BOWTIE.nodes, { v: 'F', x: 0, y: 0 }];
    const { container } = render(<NodeGraph {...BOWTIE} nodes={nodes} />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('draws no note or tone for a node named like an object member', () => {
    const { container } = render(
      <NodeGraph
        cols={2}
        rows={1}
        nodes={[{ v: 'constructor', x: 0, y: 0 }]}
        edges={[]}
        label="Un nodo."
      />,
    );
    expect(container.querySelector('[data-note]')).toBeNull();
    expect(container.querySelector('[data-node]')?.getAttribute('data-tone')).toBe('idle');
  });

  it('tells the author when an edge names a node that is not drawn', () => {
    const { container } = render(
      <NodeGraph {...THREE_CHILDREN} edges={[['+', 9]]} markEdges={[]} />,
    );
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});
