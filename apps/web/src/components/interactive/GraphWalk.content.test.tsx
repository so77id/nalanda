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

// The malla: 0 Álgebra, 1 Cálculo II, 2 Cálculo I, 3 Programación,
// 4 Ecuaciones, 5 Métodos Numéricos; one arc per prerequisite. The numbers are
// not an order, so Kahn's walk is seen to reorder them.
const MALLA = {
  directed: true,
  nodes: [
    { v: 0, x: 0, y: 1 },
    { v: 1, x: 2, y: 0 },
    { v: 2, x: 0, y: 0 },
    { v: 3, x: 0, y: 2 },
    { v: 4, x: 4, y: 0 },
    { v: 5, x: 4, y: 2 },
  ],
  edges: [
    [2, 1],
    [0, 1],
    [1, 4],
    [3, 5],
    [4, 5],
  ] as [number, number][],
  cols: 5,
  rows: 3,
  label: 'La malla.',
  caption:
    '0 Álgebra · 1 Cálculo II · 2 Cálculo I · 3 Programación · 4 Ecuaciones · 5 Métodos Numéricos',
};

const ON_PUSH = `private void dfs(Graph g, int s) {
    Stack<Integer> stack = new Stack<>();
    marked[s] = true;
    stack.push(s);
    while (!stack.empty()) {
        int v = stack.pop();
        for (int w : g.adj(v)) {
            if (!marked[w]) {
                marked[w] = true;
                stack.push(w);
            }
        }
    }
}`;

const ON_POP = `private void bfs(Graph g, int s) {
    Queue<Integer> queue = new LinkedList<>();
    queue.add(s);
    while (!queue.isEmpty()) {
        int v = queue.remove();
        if (marked[v]) {
            continue;
        }
        marked[v] = true;
        for (int w : g.adj(v)) {
            if (!marked[w]) {
                queue.add(w);
            }
        }
    }
}`;

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

const CASES: [string, GraphWalkProps, string][] = [
  [
    'El código de la búsqueda en profundidad',
    {
      ...NET,
      beside: true,
      paths: false,
      codeSrc: `${CODE}DepthFirstSearch.java`,
      codeRange: '4-16',
      lines: { mark: 10, look: [11, 12], recurse: 13, return: 16 },
    },
    'return',
  ],
  [
    'La búsqueda en profundidad con una pila',
    {
      ...NET,
      beside: true,
      algorithm: 'dfs-iterative',
      paths: false,
      codeSrc: `${CODE}IterativeDepthFirstSearch.java`,
      codeRange: '11-26',
      lines: {
        pushStart: [12, 13],
        pop: [14, 15],
        skip: [16, 17],
        mark: 19,
        look: [20, 21],
        push: 22,
        end: 14,
      },
    },
    'end',
  ],
  [
    'Marcar al apilar',
    {
      beside: true,
      algorithm: 'dfs-mark-on-push',
      paths: false,
      nodes: [
        { v: 0, x: 1, y: 0 },
        { v: 1, x: 0, y: 2 },
        { v: 2, x: 3, y: 0 },
        { v: 3, x: 2, y: 2 },
      ],
      edges: [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 3],
      ],
      cols: 4,
      rows: 3,
      code: ON_PUSH,
      lines: {
        markStart: [2, 3],
        pushStart: 4,
        pop: [5, 6],
        look: [7, 8],
        mark: 9,
        push: 10,
        end: 5,
      },
      label: 'Un triángulo con un vértice colgando.',
    },
    'end',
  ],
  [
    'La búsqueda con pila en el laberinto',
    {
      beside: true,
      algorithm: 'dfs-iterative',
      grid: ['...#', '...#', '#...'],
      codeSrc: `${CODE}IterativeMazeDepthFirstPaths.java`,
      codeRange: '30-49',
      lines: {
        pushStart: [31, 32],
        pop: [33, 34],
        skip: [35, 36],
        mark: 38,
        look: [39, 40, 41, 42, 43],
        prev: 44,
        push: 45,
        end: 33,
      },
      label: 'El laberinto.',
    },
    'end',
  ],
  [
    'Marcar al sacar de la cola',
    {
      ...FRIENDS,
      beside: true,
      algorithm: 'bfs-mark-on-pop',
      code: ON_POP,
      lines: {
        enqueueStart: [2, 3],
        dequeue: [4, 5],
        skip: [6, 7],
        mark: 9,
        look: [10, 11],
        enqueue: 12,
        end: 4,
      },
    },
    'end',
  ],
  [
    'El código de la búsqueda en anchura',
    {
      ...FRIENDS,
      beside: true,
      algorithm: 'bfs',
      codeSrc: `${CODE}BreadthFirstPaths.java`,
      codeRange: '22-38',
      lines: {
        markStart: [23, 24],
        distStart: 25,
        enqueueStart: 26,
        dequeue: [27, 28],
        look: [29, 30],
        mark: 31,
        dist: 32,
        prev: 33,
        enqueue: 34,
        end: 27,
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
      nodes: [
        { v: 0, x: 0, y: 1 },
        { v: 1, x: 2, y: 0 },
        { v: 2, x: 2, y: 2 },
        { v: 3, x: 4, y: 1 },
      ],
      edges: [
        [0, 1],
        [0, 2],
        [1, 3],
        [3, 2],
        [2, 1],
      ],
      cols: 5,
      rows: 3,
      codeSrc: `${CODE}Topological.java`,
      codeRange: '11-28',
      lines: KAHN_LINES,
      label: 'Una hoja con una referencia circular.',
      caption: '0: A1 = 5 · 1: B1 = A1 + C1 · 2: C1 = A1 + D1 · 3: D1 = B1 * 2',
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
