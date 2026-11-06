import type { CatalogEntry } from '../../lib/catalogEntry';

import { NodeGraph } from './NodeGraph';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const nodeGraphCatalogEntry: CatalogEntry = {
  name: 'NodeGraph',
  family: 'media',
  description:
    "A graph at explicit grid positions: vertices joined by edges, with arrows when it is directed, a weight centred on an edge, a self-loop, a note beside a vertex (its degree, say). Edges between the same two vertices bend apart, so a multigraph's parallel edges and a pair of opposite arrows both stay visible. A label of one or two characters sits in <BinaryPicture>'s circle; a longer one, a name, in a pill. Static: it draws one moment, and an algorithm run is <SequenceStepper>'s.",
  whenToUse:
    'When a slide shows a graph as a drawing: the model of a problem, a definition (directed, weighted, a path, a component), the degrees behind a rule. Also the counterexample to a tree that <BinaryPicture> cannot draw because its layout assumes a tree — a node with three children, a node with two parents. ' +
    'Promoted from a figure local to edd-arboles-i when edd-arboles-ii became the second document to want it (#322, add-a-course-document.md §6e-quater); #356 added arrows, weights, parallel edges, self-loops, walks, notes, pills and the flag and keep tones for the Grafos unit. ' +
    'Tones keep the design system’s meanings: mark is “look here” (an odd-degree vertex is not wrong), flag is wrong, keep is done. In a drawing with weights, name the vertices with letters so their names do not read as weights. ' +
    'Two runtime contracts, because MDX is not typechecked: a missing `label` renders an authoring error, and so does an edge that names a node the drawing does not have.',
  props: [
    {
      name: 'nodes',
      type: '{ v, x, y }[]',
      description:
        'Each vertex: its label, its column x and its row y, from 0. A fraction places it between two. A label longer than two characters widens the vertex into a pill; leave a free column beside it.',
    },
    {
      name: 'edges',
      type: '[from, to][] | [from, to, weight][]',
      description:
        "The edges, by the labels of their two ends; a third element is written on the edge as its weight, or as a word (an action, in a state graph). The same pair twice draws two edges, bent apart. An edge from a vertex to itself is a self-loop: it leaves upwards when the vertex's other edges leave that room, otherwise where they leave the most, so give the vertex room on that side.",
    },
    { name: 'cols', type: 'number', description: 'How many columns the grid has.' },
    { name: 'rows', type: 'number', description: 'How many rows the grid has.' },
    {
      name: 'directed',
      type: 'boolean',
      default: 'false',
      description: 'Arrows: each edge goes from its first vertex to its second.',
    },
    {
      name: 'tones',
      type: "Record<label, 'mark' | 'flag' | 'keep'>",
      default: '{}',
      description: 'A tone on a vertex, keyed by label: look here, wrong, done.',
    },
    {
      name: 'markEdges',
      type: '[from, to][]',
      default: '[]',
      description:
        'Edges painted thicker in mark: a path, the edges that break a rule. In an undirected graph either order matches; in a directed one, only the order given.',
    },
    {
      name: 'walk',
      type: '(string | number)[]',
      description:
        'A walk, as the vertices it visits in order: its edges are marked and each carries the number of its step, placed as <PenTrace> places its own (stepMarks in nodeGraphLayout.ts). Parallel edges are walked in turn. A step with no edge left between its two vertices renders an authoring error.',
    },
    {
      name: 'notes',
      type: 'Record<label, string | number>',
      default: '{}',
      description:
        'A short note beside a vertex, keyed by label — its degree, for instance. It goes on the side its edges leave most free, in the vertex’s tone.',
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
      title: 'Königsberg: parallel edges and the degree of every vertex',
      code: `<NodeGraph
  cols={3}
  rows={3}
  nodes={[{ v: 'B', x: 1, y: 0 }, { v: 'A', x: 0, y: 1 }, { v: 'D', x: 2, y: 1 }, { v: 'C', x: 1, y: 2 }]}
  edges={[['A', 'B'], ['A', 'B'], ['A', 'C'], ['A', 'C'], ['A', 'D'], ['B', 'D'], ['C', 'D']]}
  tones={{ A: 'mark', B: 'mark', C: 'mark', D: 'mark' }}
  notes={{ A: 5, B: 3, C: 3, D: 3 }}
  caption="cuatro vértices de grado impar"
  label="Königsberg: cuatro orillas y siete puentes; A tiene grado 5 y B, C y D, grado 3."
/>`,
      render: () => (
        <NodeGraph
          cols={3}
          rows={3}
          nodes={[
            { v: 'B', x: 1, y: 0 },
            { v: 'A', x: 0, y: 1 },
            { v: 'D', x: 2, y: 1 },
            { v: 'C', x: 1, y: 2 },
          ]}
          edges={[
            ['A', 'B'],
            ['A', 'B'],
            ['A', 'C'],
            ['A', 'C'],
            ['A', 'D'],
            ['B', 'D'],
            ['C', 'D'],
          ]}
          tones={{ A: 'mark', B: 'mark', C: 'mark', D: 'mark' }}
          notes={{ A: 5, B: 3, C: 3, D: 3 }}
          caption="cuatro vértices de grado impar"
          label="Königsberg: cuatro orillas y siete puentes; A tiene grado 5 y B, C y D, grado 3."
        />
      ),
    },
    {
      title: 'Who follows whom: arrows, names, and a follow back',
      code: `<NodeGraph
  cols={4}
  rows={2}
  directed
  nodes={[{ v: 'Ana', x: 0, y: 0 }, { v: 'Beto', x: 2, y: 0 }, { v: 'Caro', x: 1, y: 1 }, { v: 'Dani', x: 3, y: 1 }]}
  edges={[['Ana', 'Beto'], ['Beto', 'Ana'], ['Ana', 'Caro'], ['Caro', 'Beto'], ['Dani', 'Caro']]}
  tones={{ Beto: 'mark' }}
  notes={{ Beto: 2 }}
  label="Quién sigue a quién: Ana y Beto se siguen; a Beto lo siguen dos personas."
/>`,
      render: () => (
        <NodeGraph
          cols={4}
          rows={2}
          directed
          nodes={[
            { v: 'Ana', x: 0, y: 0 },
            { v: 'Beto', x: 2, y: 0 },
            { v: 'Caro', x: 1, y: 1 },
            { v: 'Dani', x: 3, y: 1 },
          ]}
          edges={[
            ['Ana', 'Beto'],
            ['Beto', 'Ana'],
            ['Ana', 'Caro'],
            ['Caro', 'Beto'],
            ['Dani', 'Caro'],
          ]}
          tones={{ Beto: 'mark' }}
          notes={{ Beto: 2 }}
          label="Quién sigue a quién: Ana y Beto se siguen; a Beto lo siguen dos personas."
        />
      ),
    },
    {
      title: 'A street map: the minutes of every block, and a path',
      code: `<NodeGraph
  cols={3}
  rows={3}
  nodes={[{ v: 'A', x: 0, y: 0 }, { v: 'B', x: 2, y: 0 }, { v: 'C', x: 1, y: 1 }, { v: 'D', x: 0, y: 2 }, { v: 'E', x: 2, y: 2 }]}
  edges={[['A', 'B', 7], ['A', 'C', 3], ['B', 'C', 2], ['C', 'D', 4], ['C', 'E', 6], ['D', 'E', 5], ['B', 'E', 9]]}
  markEdges={[['A', 'C'], ['C', 'B']]}
  label="Un mapa de calles con los minutos de cada tramo; el camino de A a B por C, marcado, suma 5."
/>`,
      render: () => (
        <NodeGraph
          cols={3}
          rows={3}
          nodes={[
            { v: 'A', x: 0, y: 0 },
            { v: 'B', x: 2, y: 0 },
            { v: 'C', x: 1, y: 1 },
            { v: 'D', x: 0, y: 2 },
            { v: 'E', x: 2, y: 2 },
          ]}
          edges={[
            ['A', 'B', 7],
            ['A', 'C', 3],
            ['B', 'C', 2],
            ['C', 'D', 4],
            ['C', 'E', 6],
            ['D', 'E', 5],
            ['B', 'E', 9],
          ]}
          markEdges={[
            ['A', 'C'],
            ['C', 'B'],
          ]}
          label="Un mapa de calles con los minutos de cada tramo; el camino de A a B por C, marcado, suma 5."
        />
      ),
    },
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
