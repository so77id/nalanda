import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyGraphWalk as GraphWalk } from './lazyGraphWalk';

// The methods are the course's own files, quoted by range (ADR-0091), as
// `<SourceFile>`'s entry quotes class 2's; the example calls are written on
// the slide, as #363 writes them. File lines: each private `dfs` starts at 17.
const DFS_SRC = 'asset:courses/sample-course/27-grafos-recorridos.code/DepthFirstPaths.java';
const ITER_SRC =
  'asset:courses/sample-course/27-grafos-recorridos.code/IterativeDepthFirstPaths.java';
const MAZE_SRC = 'asset:courses/sample-course/27-grafos-recorridos.code/MazeExit.java';
const BFS_SRC = 'asset:courses/sample-course/27-grafos-recorridos.code/BreadthFirstPaths.java';
const KAHN_SRC = 'asset:courses/sample-course/27-grafos-recorridos.code/Topological.java';

// Kahn's walk is the constructor of Topological, from 10.
const KAHN_LINES = {
  inDegrees: 11,
  check: [13, 14],
  enqueueStart: [14, 15],
  dequeue: [18, 19],
  append: 20,
  lower: [21, 22],
  enqueue: [23, 24],
  end: [18, 28],
};

// The six-course malla: 0 Cálculo I, 1 Álgebra, 2 Programación, 3 Cálculo II,
// 4 Ecuaciones, 5 Estructuras de Datos.
const MALLA = [
  { v: 0, x: 0, y: 0 },
  { v: 1, x: 0, y: 1 },
  { v: 2, x: 0, y: 2 },
  { v: 3, x: 2, y: 0 },
  { v: 4, x: 4, y: 0 },
  { v: 5, x: 2, y: 2 },
];

// The breadth-first search's bfs starts at 22.
const BFS_LINES = {
  markStart: 24,
  distStart: 25,
  enqueueStart: [23, 26],
  dequeue: [27, 28],
  look: [29, 30],
  mark: 31,
  dist: 32,
  prev: 33,
  enqueue: 34,
  end: 27,
};

// The tempting breadth-first search marks on dequeue: written inline.
const ON_POP = `private void bfs(Graph g, int s) {
    Queue<Integer> queue = new LinkedList<>();
    queue.add(s);
    while (!queue.isEmpty()) {
        int v = queue.remove();
        if (visited[v]) {
            continue;
        }
        visited[v] = true;
        for (int w : g.adj(v)) {
            if (!visited[w]) {
                queue.add(w);
            }
        }
    }
}`;

const ON_POP_LINES = {
  enqueueStart: [2, 3],
  dequeue: [4, 5],
  skip: [6, 7],
  mark: 9,
  look: [10, 11],
  enqueue: 12,
  end: 4,
};

const DIAMOND = [
  { v: 0, x: 1, y: 0 },
  { v: 1, x: 0, y: 1 },
  { v: 2, x: 2, y: 1 },
  { v: 3, x: 1, y: 2 },
];

const FIVE = [
  { v: 0, x: 0, y: 1 },
  { v: 1, x: 2, y: 0 },
  { v: 2, x: 2, y: 2 },
  { v: 3, x: 4, y: 1 },
  { v: 4, x: 6, y: 1 },
];

const PROGRAM = `Graph g = new AdjListGraph(6);
Graphs.readEdges(in, g);
DepthFirstPaths paths = new DepthFirstPaths(g, 0);`;

const LINES = { mark: 18, look: [19, 20], prev: 21, recurse: 22, return: 25 };

const ITER_LINES = {
  pushStart: [18, 19],
  pop: [20, 21],
  skip: [22, 23],
  mark: 25,
  look: [26, 27],
  prev: 28,
  push: 29,
  end: 20,
};

// MazeExit's dfs, the stack version, runs 19-46: the neighbours are computed,
// so a look is the `for`, the cell it computes and the `if` asking `free`.
const MAZE_LINES = {
  pushStart: [25, 26],
  pop: [27, 28],
  skip: [29, 30],
  mark: 32,
  look: [33, 34, 35, 36, 37],
  prev: [38, 39],
  push: 40,
  end: [27, 45],
};

// A dead end down from the entrance, which the walk takes first, and the exit
// at the far corner.
const MAZE = ['...#', '.#..', '.##.'];

const MAZE_PROGRAM = `String[] grid = {"...#", ".#..", ".##."};
int[] prev = dfs(grid, 0);`;

// The tempting version lives only on its slide: written inline (ADR-0091 §5).
const ON_PUSH = `private void dfs(Graph g, int s) {
    Stack<Integer> stack = new Stack<>();
    visited[s] = true;
    stack.push(s);
    while (!stack.empty()) {
        int v = stack.pop();
        for (int w : g.adj(v)) {
            if (!visited[w]) {
                visited[w] = true;
                prev[w] = v;
                stack.push(w);
            }
        }
    }
}`;

const ON_PUSH_LINES = {
  markStart: [2, 3],
  pushStart: 4,
  pop: [5, 6],
  look: [7, 8],
  mark: 9,
  prev: 10,
  push: 11,
  end: 5,
};

// The triangle 0-1-3 with 2 hanging from 0, off to the side: no edge crosses
// another, and none passes behind a vertex, so the jump from 3 to 2 is seen to
// have no edge under it.
const FAN = [
  { v: 0, x: 1, y: 0 },
  { v: 1, x: 0, y: 2 },
  { v: 2, x: 3, y: 0 },
  { v: 3, x: 2, y: 2 },
];

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
    'A walk over a graph, simulated and played by `<StepShow>` (ADR-0092). The frames come from a pure trace (`graphWalkTrace.ts`), so they cannot disagree with the algorithm; the listing is a file kept beside the document and quoted by range (ADR-0091) — or, for code that lives only on its slide, written inline — and `lines` says which of the file’s lines each event lights. Each frame draws the graph — the running call in mark, the finished ones in keep, the thread of calls in progress as visited edges — beside the call stack, with the `visited` and `prev` arrays under the listing. Three walks so far (#357): the recursive depth-first search; the iterative one, which keeps a stack of its own and marks on pop, drawn beside that stack; and the tempting version that marks on push, which paints red the neighbour it skips without having walked to it. The recursive and the iterative are never paired line by line: they do not take the same steps. Both also walk a maze given as `grid`, over its implicit graph: the frame is then the grid itself, `visited` the cells’ paint, the thread one line in mark from the entrance to the cell marked last, and the program’s arrays under the grid, a cell per square. Given the `exit`, the last frame says whether the walk reached it and draws the way back from it along `prev`; `programLinesAtEnd` lights where the program uses the answer. Kahn’s topological order (`kahn`, over a directed graph) draws its queue of sources, `inDegree` and `order` under the listing, and the line it builds under the graph, each arc a bow pointing right; a cycle leaves its vertices off the line, in red. The breadth-first search marks on enqueue and keeps `dist`, each vertex carrying its distance beside it and the queue drawn front first; its tempting version marks on dequeue and paints red a vertex enqueued while it is already in the queue.',
  whenToUse:
    'When a slide walks a traversal over a small graph step by step and the frames would otherwise be written by hand — fifteen to thirty `<Step>`s, each a `<NodeGraph>` and its arrays, where one copied wrong is caught by nobody. ' +
    'NOT for a single picture of a graph (`<NodeGraph>`), nor for a walk whose lesson is a structure the trace does not draw.',
  props: [
    {
      name: 'algorithm',
      type: "'dfs' | 'dfs-iterative' | 'dfs-mark-on-push' | 'bfs' | 'bfs-mark-on-pop' | 'kahn'",
      description:
        'The walk to simulate. Default `dfs`, the recursive depth-first search; `dfs-iterative`, with a stack of its own, marking on pop; `dfs-mark-on-push`, the tempting version, which does not walk depth first; `bfs`, the breadth-first search with a queue, marking on enqueue, with `dist`; `bfs-mark-on-pop`, its tempting version, which enqueues a vertex twice; `kahn`, the topological order of a directed graph.',
    },
    {
      name: 'nodes',
      type: 'NodeGraphNode[]',
      description:
        'The vertices, numbered 0..V−1 in order, each at a grid position, as `<NodeGraph>` takes them. With `edges`, `cols` and `rows`; or `grid` instead.',
    },
    {
      name: 'grid',
      type: 'string[]',
      description:
        'A maze instead of a graph: its rows, all of one length, `.` a free cell and `#` a wall. The cell in row r and column c is the vertex r · C + c, its neighbours computed up, down, left, right (`DR4`/`DC4`); every direction is a `look`, a wall and the border included. `dfs`, and `dfs-iterative`, which draws its own stack beside the grid. The arrays go under the grid, a cell per square, walls included.',
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
    {
      name: 'exit',
      type: 'number',
      description:
        'With `grid` and `dfs-iterative`: the exit cell, as r · C + c. The last frame says whether `visited` reached it and, with `prev`, draws the way back from it — the maze’s two questions.',
    },
    {
      name: 'paths',
      type: 'boolean',
      description:
        'Whether a depth-first walk keeps `prev`, the way back. Default true; false walks a search that only marks — no `prev` event, no `prev` row — for a slide that has not met the thread yet.',
    },
    {
      name: 'start',
      type: 'number',
      description:
        'The vertex the walk starts from. Default 0, or the first free cell of `grid`, row by row.',
    },
    {
      name: 'lines',
      type: 'Record<event, number | number[]>',
      description:
        'The lines each event lights, in the listing’s numbering (the file’s, with `codeSrc`). For `dfs`: `mark`, `look` (the `for` and its `if`; over a grid, also the lines computing the cell), `prev`, `recurse`, `return`. For `dfs-iterative`: `pushStart`, `pop`, `skip`, `mark`, `look`, `prev`, `push`, `end`. For `dfs-mark-on-push`: `markStart`, `pushStart`, `pop`, `look`, `mark`, `prev`, `push`, `end`. For `bfs`: `markStart`, `distStart`, `enqueueStart`, `dequeue`, `look`, `mark`, `dist`, `prev`, `enqueue`, `end`. For `bfs-mark-on-pop`: `enqueueStart`, `dequeue`, `skip`, `mark`, `look`, `enqueue`, `end`. For `kahn`: `inDegrees`, `check`, `enqueueStart`, `dequeue`, `append`, `lower`, `enqueue`, `end`. A missing one is an authoring error.',
    },
    {
      name: 'codeSrc / codeRange',
      type: 'string',
      description:
        'The file the listing quotes, relative to the document (`./27-grafos-recorridos.code/DepthFirstPaths.java`), and the range: the course’s code lives in files beside its document (ADR-0091). The listing then numbers its lines as the file does, its header names the range and «Ver archivo» opens the file whole.',
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
      name: 'programLinesAtEnd',
      type: 'number[]',
      description:
        'The program’s lines lit on the last frame instead: where the program uses what the walk left, as a maze’s prints `visited[t]`.',
    },
    {
      name: 'beside',
      type: 'boolean',
      description: 'On a slide, the drawing beside the listing (`<StepShow beside>`).',
    },
    { name: 'ratio', type: 'string', description: 'With `beside`, the "code/drawing" split.' },
    { name: 'title', type: 'string', description: 'Heading over the panels.' },
    {
      name: 'caption',
      type: 'string',
      description:
        'One line under every frame, in Spanish: what the vertex numbers stand for (`0 Ana · 1 Beto · …`) when the problem named its vertices. The walk runs on numbers, as the code does.',
    },
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
  codeSrc="./27-grafos-recorridos.code/DepthFirstPaths.java"
  codeRange="17-25"
  lines={{ mark: 18, look: [19, 20], prev: 21, recurse: 22, return: 25 }}
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
          codeRange="17-25"
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
DepthFirstPaths paths = new DepthFirstPaths(g, 0);\`}
  programLines={[3]}
  codeSrc="./27-grafos-recorridos.code/DepthFirstPaths.java"
  codeRange="17-25"
  lines={{ mark: 18, look: [19, 20], prev: 21, recurse: 22, return: 25 }}
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
          programLines={[3]}
          codeSrc={DFS_SRC}
          codeRange="17-25"
          lines={LINES}
          label="Seis vértices en dos filas, con dos ciclos."
        />
      ),
    },
    {
      title: 'DFS with a stack, on the same square: the stack turns the neighbours around',
      code: `<GraphWalk
  algorithm="dfs-iterative"
  nodes={SQUARE}
  edges={[[0, 1], [0, 2], [1, 3], [2, 3]]}
  cols={3}
  rows={3}
  codeSrc="./27-grafos-recorridos.code/IterativeDepthFirstPaths.java"
  codeRange="17-33"
  lines={{ pushStart: [18, 19], pop: [20, 21], skip: [22, 23], mark: 25,
           look: [26, 27], prev: 28, push: 29, end: 20 }}
  label="Un cuadrado de cuatro vértices: 0-1, 0-2, 1-3 y 2-3."
/>`,
      render: () => (
        <GraphWalk
          algorithm="dfs-iterative"
          nodes={SQUARE}
          edges={[
            [0, 1],
            [0, 2],
            [1, 3],
            [2, 3],
          ]}
          cols={3}
          rows={3}
          codeSrc={ITER_SRC}
          codeRange="17-33"
          lines={ITER_LINES}
          label="Un cuadrado de cuatro vértices: 0-1, 0-2, 1-3 y 2-3."
        />
      ),
    },
    {
      title: 'Marking on push, on a triangle with a vertex hanging: from 3 it jumps to 2',
      code: `<GraphWalk
  algorithm="dfs-mark-on-push"
  nodes={FAN}
  edges={[[0, 1], [0, 2], [0, 3], [1, 3]]}
  cols={4}
  rows={3}
  code={ON_PUSH}
  lines={{ markStart: [2, 3], pushStart: 4, pop: [5, 6], look: [7, 8],
           mark: 9, prev: 10, push: 11, end: 5 }}
  label="Un triángulo 0-1-3, y el vértice 2 colgando de 0."
/>`,
      render: () => (
        <GraphWalk
          algorithm="dfs-mark-on-push"
          nodes={FAN}
          edges={[
            [0, 1],
            [0, 2],
            [0, 3],
            [1, 3],
          ]}
          cols={4}
          rows={3}
          code={ON_PUSH}
          lines={ON_PUSH_LINES}
          label="Un triángulo 0-1-3, y el vértice 2 colgando de 0."
        />
      ),
    },
    {
      title: 'DFS with its own stack over a maze, and the thread back from the exit at the end',
      code: `<GraphWalk
  algorithm="dfs-iterative"
  grid={['...#', '.#..', '.##.']}
  exit={11}
  program={\`String[] grid = {"...#", ".#..", ".##."};
int[] prev = dfs(grid, 0);\`}
  programLines={[2]}
  codeSrc="./27-grafos-recorridos.code/MazeExit.java"
  codeRange="19-46"
  lines={{ pushStart: [25, 26], pop: [27, 28], skip: [29, 30], mark: 32, look: [33, 34, 35, 36, 37], prev: [38, 39], push: 40, end: [27, 45] }}
  label="Un laberinto de 3 por 4, con la entrada arriba a la izquierda y la salida abajo a la derecha."
/>`,
      render: () => (
        <GraphWalk
          algorithm="dfs-iterative"
          grid={MAZE}
          exit={11}
          program={MAZE_PROGRAM}
          programLines={[2]}
          codeSrc={MAZE_SRC}
          codeRange="19-46"
          lines={MAZE_LINES}
          label="Un laberinto de 3 por 4, con la entrada arriba a la izquierda y la salida abajo a la derecha."
        />
      ),
    },
    {
      title: 'BFS on five vertices: each vertex enqueued once, with its distance',
      code: `<GraphWalk
  algorithm="bfs"
  nodes={FIVE}
  edges={[[0, 1], [0, 2], [1, 3], [2, 3], [3, 4]]}
  cols={7}
  rows={3}
  codeSrc="./27-grafos-recorridos.code/BreadthFirstPaths.java"
  codeRange="22-38"
  lines={{ markStart: 24, distStart: 25, enqueueStart: [23, 26], dequeue: [27, 28],
           look: [29, 30], mark: 31, dist: 32, prev: 33, enqueue: 34, end: 27 }}
  label="Un grafo de cinco vértices: 0 unido a 1 y a 2, 1 y 2 unidos a 3, y 3 unido a 4."
/>`,
      render: () => (
        <GraphWalk
          algorithm="bfs"
          nodes={FIVE}
          edges={[
            [0, 1],
            [0, 2],
            [1, 3],
            [2, 3],
            [3, 4],
          ]}
          cols={7}
          rows={3}
          codeSrc={BFS_SRC}
          codeRange="22-38"
          lines={BFS_LINES}
          label="Un grafo de cinco vértices: 0 unido a 1 y a 2, 1 y 2 unidos a 3, y 3 unido a 4."
        />
      ),
    },
    {
      title: 'Marking on dequeue, on a diamond: 3 enters the queue twice',
      code: `<GraphWalk
  algorithm="bfs-mark-on-pop"
  nodes={DIAMOND}
  edges={[[0, 1], [0, 2], [1, 3], [2, 3]]}
  cols={3}
  rows={3}
  code={ON_POP}
  lines={{ enqueueStart: [2, 3], dequeue: [4, 5], skip: [6, 7], mark: 9,
           look: [10, 11], enqueue: 12, end: 4 }}
  label="Un rombo: 0 unido a 1 y a 2, y los dos unidos a 3."
/>`,
      render: () => (
        <GraphWalk
          algorithm="bfs-mark-on-pop"
          nodes={DIAMOND}
          edges={[
            [0, 1],
            [0, 2],
            [1, 3],
            [2, 3],
          ]}
          cols={3}
          rows={3}
          code={ON_POP}
          lines={ON_POP_LINES}
          label="Un rombo: 0 unido a 1 y a 2, y los dos unidos a 3."
        />
      ),
    },
    {
      title: 'Kahn on a malla of six courses: the line every arc points right on',
      code: `<GraphWalk
  algorithm="kahn"
  directed
  nodes={MALLA}
  edges={[[0, 3], [3, 4], [1, 4], [2, 5], [1, 5]]}
  cols={5}
  rows={3}
  codeSrc="./27-grafos-recorridos.code/Topological.java"
  codeRange="10-29"
  lines={{ inDegrees: 11, check: [13, 14], enqueueStart: [14, 15], dequeue: [18, 19],
           append: 20, lower: [21, 22], enqueue: [23, 24], end: [18, 28] }}
  label="Una malla de seis ramos."
/>`,
      render: () => (
        <GraphWalk
          algorithm="kahn"
          directed
          nodes={MALLA}
          edges={[
            [0, 3],
            [3, 4],
            [1, 4],
            [2, 5],
            [1, 5],
          ]}
          cols={5}
          rows={3}
          codeSrc={KAHN_SRC}
          codeRange="10-29"
          lines={KAHN_LINES}
          label="Una malla de seis ramos: Cálculo I, Álgebra, Programación, Cálculo II, Ecuaciones y Estructuras de Datos."
        />
      ),
    },
  ],
};
