import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyGraphWalk as GraphWalk } from './lazyGraphWalk';

// The method is the course's own file, quoted by range (ADR-0091), as
// `<SourceFile>`'s entry quotes class 2's; the example calls are written on
// the slide, as #363 writes them. File lines: the method is 2-10.
const DFS_SRC = 'asset:courses/sample-course/27-grafos-recorridos.code/Traversals.java';

const PROGRAM = `Graph g = new AdjListGraph(6);
Graphs.readEdges(in, g);
boolean[] marked = new boolean[g.V()];
int[] prev = new int[g.V()];
Arrays.fill(prev, -1);
Traversals.dfs(g, 0, marked, prev);`;

const LINES = { mark: 3, look: [4, 5], prev: 6, recurse: 7, return: 10 };

const SQUARE = [
  { v: 0, x: 0, y: 0 },
  { v: 1, x: 2, y: 0 },
  { v: 2, x: 0, y: 2 },
  { v: 3, x: 2, y: 2 },
];

const SIX = [
  { v: 0, x: 0, y: 1 },
  { v: 1, x: 2, y: 0 },
  { v: 2, x: 2, y: 2 },
  { v: 3, x: 4, y: 0 },
  { v: 4, x: 4, y: 2 },
  { v: 5, x: 6, y: 1 },
];

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const graphWalkCatalogEntry: CatalogEntry = {
  name: 'GraphWalk',
  family: 'interactive',
  description:
    'A walk over a graph, simulated and played by `<StepShow>` (ADR-0092). The frames come from a pure trace (`graphWalkTrace.ts`), so they cannot disagree with the algorithm; the listing is a file kept beside the document and quoted by range (ADR-0091) — or, for code that lives only on its slide, written inline — and `lines` says which of the file’s lines each event lights. Each frame draws the graph — the running call in mark, the finished ones in keep, the thread of calls in progress as marked edges — over the call stack and the `marked` and `prev` arrays. Only the recursive depth-first search so far (#357).',
  whenToUse:
    'When a slide walks a traversal over a small graph step by step and the frames would otherwise be written by hand — fifteen to thirty `<Step>`s, each a `<NodeGraph>` and its arrays, where one copied wrong is caught by nobody. ' +
    'NOT for a single picture of a graph (`<NodeGraph>`), nor for a walk whose lesson is a structure the trace does not draw.',
  props: [
    {
      name: 'algorithm',
      type: "'dfs'",
      description: 'The walk to simulate. Default `dfs`, the recursive depth-first search.',
    },
    {
      name: 'nodes',
      type: 'NodeGraphNode[]',
      description:
        'The vertices, numbered 0..V−1 in order, each at a grid position, as `<NodeGraph>` takes them.',
    },
    {
      name: 'edges',
      type: '[number, number][]',
      description:
        'The edges in the order the program adds them: that is the order of each adjacency list, so the order the walk visits neighbours in.',
    },
    { name: 'cols', type: 'number', description: 'Columns of the drawing’s grid.' },
    { name: 'rows', type: 'number', description: 'Rows of the drawing’s grid.' },
    { name: 'directed', type: 'boolean', description: 'Arcs instead of edges. Default false.' },
    { name: 'start', type: 'number', description: 'The vertex the walk starts from. Default 0.' },
    {
      name: 'lines',
      type: 'Record<event, number | number[]>',
      description:
        'The lines each event lights, in the listing’s numbering (the file’s, with `codeSrc`). For `dfs`: `mark`, `look` (the `for` and its `if`), `prev`, `recurse`, `return`. A missing one is an authoring error.',
    },
    {
      name: 'codeSrc / codeRange',
      type: 'string',
      description:
        'The file the listing quotes, relative to the document (`./27-grafos-recorridos.code/Traversals.java`), and the range: the course’s code lives in files beside its document (ADR-0091). The listing then numbers its lines as the file does, its header names the range and «Ver archivo» opens the file whole.',
    },
    {
      name: 'code',
      type: 'string',
      description:
        'The listing written in the document, for code that exists only on its slide (ADR-0091 §5). Named after the method so the arrays still show under it.',
    },
    { name: 'codeName', type: 'string', description: 'The badge over the listing.' },
    {
      name: 'program / programSrc / programRange / programName',
      type: 'string',
      description: 'The program that calls the walk, shown over the listing, as on `<StepShow>`.',
    },
    {
      name: 'programLines',
      type: 'number[]',
      description: 'The program’s lines lit in every frame: the call the walk is inside.',
    },
    {
      name: 'beside',
      type: 'boolean',
      description: 'On a slide, the drawing beside the listing (`<StepShow beside>`).',
    },
    { name: 'ratio', type: 'string', description: 'With `beside`, the "code/drawing" split.' },
    { name: 'title', type: 'string', description: 'Heading over the panels.' },
    {
      name: 'label',
      type: 'string',
      description: 'What the graph is, in Spanish; each frame’s drawing adds what it shows.',
    },
  ],
  examples: [
    {
      title: 'DFS on a square: the fourth vertex is reached through the long way',
      code: `<GraphWalk
  nodes={[{ v: 0, x: 0, y: 0 }, { v: 1, x: 2, y: 0 }, { v: 2, x: 0, y: 2 }, { v: 3, x: 2, y: 2 }]}
  edges={[[0, 1], [0, 2], [1, 3], [2, 3]]}
  cols={3}
  rows={3}
  codeSrc="./27-grafos-recorridos.code/Traversals.java"
  codeRange="2-10"
  lines={{ mark: 3, look: [4, 5], prev: 6, recurse: 7, return: 10 }}
  label="Un cuadrado de cuatro vértices: 0-1, 0-2, 1-3 y 2-3."
/>`,
      render: () => (
        <GraphWalk
          nodes={SQUARE}
          edges={[
            [0, 1],
            [0, 2],
            [1, 3],
            [2, 3],
          ]}
          cols={3}
          rows={3}
          codeSrc={DFS_SRC}
          codeRange="2-10"
          lines={LINES}
          label="Un cuadrado de cuatro vértices: 0-1, 0-2, 1-3 y 2-3."
        />
      ),
    },
    {
      title: 'DFS on six vertices, under the calls written on the slide',
      code: `<GraphWalk
  nodes={SIX}
  edges={[[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 5], [4, 5]]}
  cols={7}
  rows={3}
  program={\`Graph g = new AdjListGraph(6);
Graphs.readEdges(in, g);
boolean[] marked = new boolean[g.V()];
int[] prev = new int[g.V()];
Arrays.fill(prev, -1);
Traversals.dfs(g, 0, marked, prev);\`}
  programLines={[6]}
  codeSrc="./27-grafos-recorridos.code/Traversals.java"
  codeRange="2-10"
  lines={{ mark: 3, look: [4, 5], prev: 6, recurse: 7, return: 10 }}
  label="Seis vértices en dos filas, con dos ciclos."
/>`,
      render: () => (
        <GraphWalk
          nodes={SIX}
          edges={[
            [0, 1],
            [0, 2],
            [1, 2],
            [1, 3],
            [2, 4],
            [3, 5],
            [4, 5],
          ]}
          cols={7}
          rows={3}
          program={PROGRAM}
          programLines={[6]}
          codeSrc={DFS_SRC}
          codeRange="2-10"
          lines={LINES}
          label="Seis vértices en dos filas, con dos ciclos."
        />
      ),
    },
  ],
};
