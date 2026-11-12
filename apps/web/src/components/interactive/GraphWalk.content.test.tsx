import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { GraphWalk, type GraphWalkProps } from './GraphWalk';

// `<GraphWalk>` is registered lazily, so the document-render test never mounts
// it (apps/web/CLAUDE.md, the fourth class): every combination the document
// mounts is pinned here, with the real course files, and walked to its end.
const CODE = 'asset:courses/sample-course/27-grafos-recorridos.code/';

const FIVE = {
  nodes: [
    { v: 0, x: 0, y: 1 },
    { v: 1, x: 2, y: 0 },
    { v: 2, x: 2, y: 2 },
    { v: 3, x: 4, y: 1 },
    { v: 4, x: 6, y: 1 },
  ],
  edges: [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 4],
  ] as [number, number][],
  cols: 7,
  rows: 3,
  label: 'Un grafo de cinco vértices.',
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
                prev[w] = v;
                stack.push(w);
            }
        }
    }
}`;

const ON_POP = `private void bfs(Graph g, int s) {
    Queue<Integer> queue = new ArrayDeque<>();
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

const CASES: [string, GraphWalkProps, string, number][] = [
  [
    'El código de la búsqueda en profundidad',
    {
      ...FIVE,
      beside: true,
      codeSrc: `${CODE}DepthFirstPaths.java`,
      codeRange: '10-25',
      lines: { mark: 18, look: [19, 20], prev: 21, recurse: 22, return: 25 },
    },
    'return',
    28,
  ],
  [
    'La búsqueda en profundidad en el laberinto',
    {
      beside: true,
      grid: ['...#', '.#..', '.##.'],
      codeSrc: `${CODE}MazeDepthFirstPaths.java`,
      codeRange: '30-41',
      lines: { mark: 31, look: [32, 33, 34, 35, 36], prev: 37, recurse: 38, return: 41 },
      label: 'El laberinto.',
    },
    'return',
    62,
  ],
  [
    'Marcar al apilar',
    {
      beside: true,
      algorithm: 'dfs-mark-on-push',
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
        prev: 10,
        push: 11,
        end: 5,
      },
      label: 'Un triángulo con un vértice colgando.',
    },
    'end',
    0,
  ],
  [
    'El código de la búsqueda en profundidad iterativa',
    {
      ...FIVE,
      beside: true,
      algorithm: 'dfs-iterative',
      codeSrc: `${CODE}IterativeDepthFirstPaths.java`,
      codeRange: '17-33',
      lines: {
        pushStart: [18, 19],
        pop: [20, 21],
        skip: [22, 23],
        mark: 25,
        look: [26, 27],
        prev: 28,
        push: 29,
        end: 20,
      },
    },
    'end',
    0,
  ],
  [
    'El recorrido por niveles en un grafo',
    {
      beside: true,
      algorithm: 'bfs-mark-on-pop',
      nodes: [
        { v: 0, x: 1, y: 0 },
        { v: 1, x: 0, y: 1 },
        { v: 2, x: 2, y: 1 },
        { v: 3, x: 1, y: 2 },
      ],
      edges: [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 3],
      ],
      cols: 3,
      rows: 3,
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
      label: 'Un rombo.',
    },
    'end',
    0,
  ],
  [
    'El código de la búsqueda en anchura',
    {
      ...FIVE,
      beside: true,
      algorithm: 'bfs',
      codeSrc: `${CODE}BreadthFirstPaths.java`,
      codeRange: '22-38',
      lines: {
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
      },
    },
    'end',
    0,
  ],
];

describe('the combinations 27-grafos-recorridos mounts', () => {
  it.each(CASES)('%s', async (_slide, props, lastEvent, steps) => {
    const { container } = render(<GraphWalk {...props} />);
    expect(container.querySelector('[data-authoring-error]')).toBeNull();
    // The listing came from the real file: its header names the range.
    if (props.codeSrc) expect(screen.getAllByText(/líneas \d+–\d+ de/).length).toBeGreaterThan(0);
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    let taken = 1;
    while (next.getAttribute('aria-disabled') !== 'true') {
      await user.click(next);
      taken++;
    }
    expect(screen.getByTestId('graph-walk-frame')).toHaveAttribute('data-event', lastEvent);
    if (steps > 0) expect(taken).toBe(steps);
    expect(container.querySelector('[data-authoring-error]')).toBeNull();
  });
});
