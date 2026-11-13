import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { GraphWalk, type GraphWalkProps } from './GraphWalk';

// `<GraphWalk>` is registered lazily, so the document-render test never mounts
// it (apps/web/CLAUDE.md, the fourth class): every combination the document
// mounts is pinned here, with the real course files, and walked to its end.
const CODE = 'asset:courses/sample-course/27-grafos-recorridos.code/';

// The power network: 0 the plant; 1, 2, 3 and 6 poles; 4, 5 and 7 houses.
const NET = {
  nodes: [
    { v: 0, x: 0, y: 1 },
    { v: 1, x: 2, y: 1 },
    { v: 2, x: 4, y: 0 },
    { v: 3, x: 4, y: 2 },
    { v: 4, x: 6, y: 0 },
    { v: 5, x: 6, y: 2 },
    { v: 6, x: 8, y: 2 },
    { v: 7, x: 8, y: 0 },
  ],
  edges: [
    [0, 1],
    [1, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [3, 5],
    [6, 7],
  ] as [number, number][],
  cols: 9,
  rows: 3,
  label: 'Una red eléctrica.',
};

// The friends: 0 Ana, 1 Beto, 2 Carla, 3 Diego, 4 Elena; Carla-Diego is read
// third, so that both depth-first searches give a chain of four.
const FRIENDS = {
  nodes: [
    { v: 0, x: 1, y: 1 },
    { v: 1, x: 3, y: 0 },
    { v: 2, x: 3, y: 2 },
    { v: 3, x: 5, y: 1 },
    { v: 4, x: 7, y: 2 },
  ],
  edges: [
    [0, 1],
    [0, 2],
    [2, 3],
    [1, 2],
    [1, 3],
    [3, 4],
  ] as [number, number][],
  cols: 8,
  rows: 3,
  label: 'Una red de amigos.',
  caption: '0 Ana · 1 Beto · 2 Carla · 3 Diego · 4 Elena',
};

// The malla: class 1's, two courses more. 0 Álgebra, 1 Cálculo I, 2 Cálculo
// II, 3 Métodos Numéricos, 4 Ecuaciones, 5 Programación: the numbers are not
// an order, so Kahn's walk is seen to reorder them.
const MALLA = {
  directed: true,
  nodes: [
    { v: 0, x: 0, y: 1 },
    { v: 1, x: 0, y: 0 },
    { v: 2, x: 2, y: 0 },
    { v: 3, x: 4, y: 2 },
    { v: 4, x: 4, y: 0 },
    { v: 5, x: 0, y: 2 },
  ],
  edges: [
    [1, 2],
    [2, 4],
    [0, 4],
    [5, 3],
    [4, 3],
  ] as [number, number][],
  cols: 5,
  rows: 3,
  label: 'La malla.',
  caption:
    '0 Álgebra · 1 Cálculo I · 2 Cálculo II · 3 Métodos Numéricos · 4 Ecuaciones · 5 Programación',
};

const KAHN_LINES = {
  inDegrees: [11, 12],
  check: [13, 14],
  enqueueStart: [14, 15],
  dequeue: [18, 19],
  append: 20,
  lower: [21, 22],
  enqueue: [23, 24],
  end: [18, 28],
};

const CASES: [string, GraphWalkProps, string][] = [
  [
    'La búsqueda con pila en la red eléctrica',
    {
      ...NET,
      beside: true,
      algorithm: 'dfs-iterative',
      paths: false,
      codeSrc: `${CODE}TemplateStack.java`,
      codeRange: '4-22',
      lines: {
        pushStart: [5, 6, 7],
        pop: [8, 9],
        skip: [10, 11],
        mark: [13, 14],
        look: [15, 16],
        push: 17,
        end: 8,
      },
    },
    'end',
  ],
  [
    '¿Se llega a la salida?',
    {
      beside: true,
      ratio: '55/45',
      algorithm: 'dfs-iterative',
      paths: false,
      grid: ['...#', '...#', '#...'],
      exit: 11,
      codeSrc: `${CODE}MazeReach.java`,
      codeRange: '16-39',
      lines: {
        pushStart: [19, 20],
        pop: [21, 22],
        skip: [23, 24],
        mark: 26,
        look: [29, 30, 31, 32, 33],
        push: 34,
        end: [21, 38],
      },
      program: 'boolean[] visited = dfs(grid, 0);\nSystem.out.println(visited[11]);',
      programLines: [1],
      programLinesAtEnd: [2],
      label: 'El laberinto.',
    },
    'end',
  ],
  [
    'La búsqueda que deja el hilo',
    {
      beside: true,
      exit: 11,
      algorithm: 'dfs-iterative',
      grid: ['...#', '...#', '#...'],
      codeSrc: `${CODE}MazeExit.java`,
      codeRange: '19-46',
      lines: {
        pushStart: [25, 26],
        pop: [27, 28],
        skip: [29, 30],
        mark: 32,
        look: [33, 34, 35, 36, 37],
        prev: [38, 39],
        push: 40,
        end: [27, 45],
      },
      label: 'El laberinto.',
    },
    'end',
  ],
  [
    'La búsqueda en anchura en el laberinto',
    {
      beside: true,
      ratio: '50/50',
      algorithm: 'bfs',
      dist: false,
      grid: ['...#', '...#', '#...'],
      exit: 11,
      codeSrc: `${CODE}MazeShortest.java`,
      codeRange: '21-47',
      lines: {
        markStart: [26, 27, 28, 29],
        enqueueStart: 30,
        dequeue: [31, 32, 33],
        look: [34, 35, 36, 37, 38],
        mark: [39, 40],
        prev: 41,
        enqueue: 42,
        end: [31, 46],
      },
      label: 'El laberinto.',
    },
    'end',
  ],
  [
    'La búsqueda que cuenta los saltos',
    {
      ...FRIENDS,
      beside: true,
      ratio: '50/50',
      algorithm: 'bfs',
      paths: false,
      arraysAt: 'drawing',
      codeSrc: `${CODE}FriendDistance.java`,
      codeRange: '7-28',
      lines: {
        markStart: [12, 13],
        distStart: 14,
        enqueueStart: 15,
        dequeue: [16, 17],
        look: [18, 19],
        mark: 20,
        dist: [21, 22],
        enqueue: 23,
        end: [16, 27],
      },
    },
    'end',
  ],
  [
    'El código del orden topológico',
    {
      ...MALLA,
      beside: true,
      algorithm: 'kahn',
      codeSrc: `${CODE}Topological.java`,
      codeRange: '11-28',
      lines: KAHN_LINES,
    },
    'end',
  ],
  [
    'Una referencia circular',
    {
      beside: true,
      algorithm: 'kahn',
      directed: true,
      ratio: '45/55',
      // The sheet of the slide before, with D1 = A1 + C1: B1, C1 and D1
      // read each other in a cycle. 0 A1, 1 B1, 2 C1, 3 D1.
      nodes: [
        { v: 0, x: 0, y: 1 },
        { v: 1, x: 2, y: 0 },
        { v: 2, x: 4, y: 1 },
        { v: 3, x: 2, y: 2 },
      ],
      edges: [
        [0, 2],
        [1, 2],
        [3, 1],
        [0, 3],
        [2, 3],
      ],
      cols: 5,
      rows: 3,
      codeSrc: `${CODE}Topological.java`,
      codeRange: '11-28',
      lines: KAHN_LINES,
      label: 'Una hoja con una referencia circular.',
      caption: 'la misma hoja, con D1 = A1 + C1; los números: 0 es A1, 1 es B1, 2 es C1, 3 es D1',
    },
    'end',
  ],
];

describe('the combinations 27-grafos-recorridos mounts', () => {
  it.each(CASES)('%s', async (_slide, props, lastEvent) => {
    const { container } = render(<GraphWalk {...props} />);
    expect(container.querySelector('[data-authoring-error]')).toBeNull();
    // The listing came from the real file: its header names the range.
    if (props.codeSrc) expect(screen.getAllByText(/líneas \d+–\d+ de/).length).toBeGreaterThan(0);
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    while (next.getAttribute('aria-disabled') !== 'true') {
      await user.click(next);
    }
    expect(screen.getByTestId('graph-walk-frame')).toHaveAttribute('data-event', lastEvent);
    // The legend under the frame names what the numbers stand for.
    if (props.caption)
      expect(screen.getByTestId('graph-walk-caption')).toHaveTextContent(props.caption);
    expect(container.querySelector('[data-authoring-error]')).toBeNull();
  });
});
