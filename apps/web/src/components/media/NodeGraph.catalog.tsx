import type { CatalogEntry } from '../../lib/catalogEntry';

import { NodeGraph } from './NodeGraph';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const nodeGraphCatalogEntry: CatalogEntry = {
  name: 'NodeGraph',
  family: 'media',
  description:
    "Nodes at explicit grid positions, joined by edges: for a shape no tree layout can draw — a node with three children, a node with two parents. The nodes are <BinaryPicture>'s circles at its size; a node or an edge in mark is the one that breaks the rule the drawing shows.",
  whenToUse:
    "When a slide shows a COUNTEREXAMPLE to a tree's invariants: something that is not a tree, which <BinaryPicture> cannot draw because its layout assumes one. A tree that is one goes to <BinaryPicture>. " +
    'Promoted from a figure local to edd-arboles-i when edd-arboles-ii became the second document to want it (#322, add-a-course-document.md §6e-quater). ' +
    'Two runtime contracts, because MDX is not typechecked: a missing `label` renders an authoring error, and so does an edge that names a node the drawing does not have.',
  props: [
    {
      name: 'nodes',
      type: '{ v, x, y }[]',
      description:
        'Each node: its value, its column x and its row y, from 0. A half column places a node between two, as a parent over two children.',
    },
    {
      name: 'edges',
      type: '[from, to][]',
      description: 'The edges, by the values of their two ends, drawn from the upper to the lower.',
    },
    { name: 'cols', type: 'number', description: 'How many columns the grid has.' },
    { name: 'rows', type: 'number', description: 'How many rows the grid has.' },
    {
      name: 'tones',
      type: "Record<value, 'mark'>",
      default: '{}',
      description: 'The node that breaks the rule, painted in mark, keyed by value.',
    },
    {
      name: 'markEdges',
      type: '[from, to][]',
      default: '[]',
      description: 'The edges that break it, thicker and in mark.',
    },
    { name: 'caption', type: 'string', description: 'A line under the drawing.' },
    {
      name: 'label',
      type: 'string',
      description: 'What the figure shows, in Spanish: its accessible name. Required.',
    },
  ],
  examples: [
    {
      title: 'A node with three children: not a binary tree',
      code: `<NodeGraph
  cols={3}
  rows={2}
  nodes={[{ v: '+', x: 1, y: 0 }, { v: 3, x: 0, y: 1 }, { v: 4, x: 1, y: 1 }, { v: 5, x: 2, y: 1 }]}
  edges={[['+', 3], ['+', 4], ['+', 5]]}
  tones={{ '+': 'mark' }}
  markEdges={[['+', 3], ['+', 4], ['+', 5]]}
  caption="tres hijos"
  label="Un nodo con tres hijos: el suma tiene al 3, al 4 y al 5 debajo."
/>`,
      render: () => (
        <NodeGraph
          cols={3}
          rows={2}
          nodes={[
            { v: '+', x: 1, y: 0 },
            { v: 3, x: 0, y: 1 },
            { v: 4, x: 1, y: 1 },
            { v: 5, x: 2, y: 1 },
          ]}
          edges={[
            ['+', 3],
            ['+', 4],
            ['+', 5],
          ]}
          tones={{ '+': 'mark' }}
          markEdges={[
            ['+', 3],
            ['+', 4],
            ['+', 5],
          ]}
          caption="tres hijos"
          label="Un nodo con tres hijos: el suma tiene al 3, al 4 y al 5 debajo."
        />
      ),
    },
    {
      title: 'A node with two parents: not a tree',
      code: `<NodeGraph
  cols={3}
  rows={2}
  nodes={[{ v: '+', x: 0.5, y: 0 }, { v: '*', x: 1.5, y: 0 }, { v: 4, x: 1, y: 1 }]}
  edges={[['+', 4], ['*', 4]]}
  tones={{ 4: 'mark' }}
  markEdges={[['+', 4], ['*', 4]]}
  caption="dos padres"
  label="Un nodo con dos padres: el 4 cuelga del suma y del producto."
/>`,
      render: () => (
        <NodeGraph
          cols={3}
          rows={2}
          nodes={[
            { v: '+', x: 0.5, y: 0 },
            { v: '*', x: 1.5, y: 0 },
            { v: 4, x: 1, y: 1 },
          ]}
          edges={[
            ['+', 4],
            ['*', 4],
          ]}
          tones={{ 4: 'mark' }}
          markEdges={[
            ['+', 4],
            ['*', 4],
          ]}
          caption="dos padres"
          label="Un nodo con dos padres: el 4 cuelga del suma y del producto."
        />
      ),
    },
  ],
};
