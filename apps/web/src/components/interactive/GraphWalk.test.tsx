import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GraphWalk } from './GraphWalk';

// The course's files arrive through a Vite glob the suite does not need to
// exercise (as in StepShow.test.tsx): one made-up file stands in for them,
// the method at lines 2-10 of an eleven-line class.
vi.mock('../../lib/contentCode', () => ({
  resolveCode: (src: string) =>
    ({
      'asset:x.code/Traversals.java': [
        'public class Traversals {',
        '    static void dfs(Graph g, int v, boolean[] visited, int[] prev) {',
        '        visited[v] = true;',
        '        for (int w : g.adj(v)) {',
        '            if (!visited[w]) {',
        '                prev[w] = v;',
        '                dfs(g, w, visited, prev);',
        '            }',
        '        }',
        '    }',
        '}',
        '',
      ].join('\n'),
    })[src] ?? null,
}));

const DFS = `static void dfs(Graph g, int v, boolean[] visited, int[] prev) {
    visited[v] = true;
    for (int w : g.adj(v)) {
        if (!visited[w]) {
            prev[w] = v;
            dfs(g, w, visited, prev);
        }
    }
}`;

const LINES = { mark: 2, look: [3, 4], prev: 5, recurse: 6, return: 9 };

const TRIANGLE = [
  { v: 0, x: 0, y: 0 },
  { v: 1, x: 2, y: 0 },
  { v: 2, x: 1, y: 2 },
];

function triangle() {
  return (
    <GraphWalk
      nodes={TRIANGLE}
      edges={[
        [0, 1],
        [0, 2],
        [1, 2],
      ]}
      cols={3}
      rows={3}
      code={DFS}
      lines={LINES}
      label="Un triángulo."
    />
  );
}

// The iterative search, marking on pop, and the tempting one marking on push
// (#357 S5): inline listings, numbered from 1.
const ITER = `private void dfs(Graph g, int s) {
    Stack<Integer> stack = new Stack<>();
    stack.push(s);
    while (!stack.empty()) {
        int v = stack.pop();
        if (visited[v]) {
            continue;
        }
        visited[v] = true;
        for (int w : g.adj(v)) {
            if (!visited[w]) {
                prev[w] = v;
                stack.push(w);
            }
        }
    }
}`;
const ITER_LINES = {
  pushStart: [2, 3],
  pop: [4, 5],
  skip: [6, 7],
  mark: 9,
  look: [10, 11],
  prev: 12,
  push: 13,
  end: 4,
};
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
// The fan 0-1, 0-2, 0-3 with the chord 1-3.
const FAN_NODES = [
  { v: 0, x: 1, y: 0 },
  { v: 1, x: 0, y: 2 },
  { v: 2, x: 1, y: 2 },
  { v: 3, x: 2, y: 2 },
];
const FAN_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 3],
];

function frame(): HTMLElement {
  return screen.getByTestId('graph-walk-frame');
}

async function forward(times: number) {
  const user = userEvent.setup();
  for (let i = 0; i < times; i++) {
    await user.click(screen.getByRole('button', { name: /adelante/i }));
  }
}

describe('GraphWalk', () => {
  it('opens on the first call marking the start', () => {
    render(triangle());
    expect(frame()).toHaveAttribute('data-event', 'mark');
    expect(frame()).toHaveAttribute('data-v', '0');
    expect(screen.getByText('dfs(0) marca 0.')).toBeInTheDocument();
  });

  it('draws the call stack and the arrays the frame holds', () => {
    render(triangle());
    expect(
      screen.getByRole('img', { name: /Pila de llamadas: dfs\(0\); corre dfs\(0\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'visited: true, false, false; prev: −1, −1, −1' }),
    ).toBeInTheDocument();
  });

  it('steps through the simulated walk: look, prev, then the call', async () => {
    render(triangle());
    await forward(1);
    expect(frame()).toHaveAttribute('data-event', 'look');
    expect(frame()).toHaveAttribute('data-w', '1');
    await forward(1);
    expect(frame()).toHaveAttribute('data-event', 'prev');
    expect(
      screen.getByRole('img', { name: 'visited: true, false, false; prev: −1, 0, −1' }),
    ).toBeInTheDocument();
    await forward(2);
    expect(frame()).toHaveAttribute('data-event', 'mark');
    expect(frame()).toHaveAttribute('data-v', '1');
    expect(
      screen.getByRole('img', { name: /Pila de llamadas: dfs\(0\), dfs\(1\); corre dfs\(1\)/ }),
    ).toBeInTheDocument();
  });

  it('quotes the method from its file (ADR-0091) and lights the file’s line of each event', async () => {
    render(
      <GraphWalk
        nodes={TRIANGLE}
        edges={[
          [0, 1],
          [0, 2],
          [1, 2],
        ]}
        cols={3}
        rows={3}
        codeSrc="asset:x.code/Traversals.java"
        codeRange="2-10"
        lines={{ mark: 3, look: [4, 5], prev: 6, recurse: 7, return: 10 }}
        label="Un triángulo."
      />,
    );
    expect(screen.getByTestId('stepshow-listing').dataset['listing']).toBe('Traversals.java');
    expect(screen.getByTestId('listing-range').textContent).toBe('líneas 2–10 de 11');
    // StepShow announces the step and its lit lines in a status region.
    const live = () =>
      Array.from(document.querySelectorAll('[aria-live="polite"]'))
        .map((e) => e.textContent)
        .join(' | ');
    expect(live()).toMatch(/Paso 1 de \d+, línea 3\./);
    // The arrays the program holds go under the named listing.
    expect(screen.getByTestId('stepshow-under')).toHaveTextContent('visited');
    await forward(1);
    expect(live()).toMatch(/Paso 2 de \d+, líneas 4 y 5\./);
  });

  it('survives a parent re-render with the same graph without resetting the step', async () => {
    const { rerender } = render(triangle());
    await forward(2);
    expect(frame()).toHaveAttribute('data-event', 'prev');
    await act(async () => {
      rerender(triangle());
    });
    expect(frame()).toHaveAttribute('data-event', 'prev');
  });

  it('tells the author which event has no lines', () => {
    render(
      <GraphWalk
        nodes={TRIANGLE}
        edges={[[0, 1]]}
        cols={3}
        rows={3}
        code={DFS}
        lines={{ mark: 2, look: [3, 4] }}
        label="Un triángulo."
      />,
    );
    expect(
      screen.getByText(/faltan en lines las líneas de prev, recurse, return/),
    ).toBeInTheDocument();
  });

  it('tells the author when the vertices are not 0..V−1 in order', () => {
    render(
      <GraphWalk
        nodes={[
          { v: 1, x: 0, y: 0 },
          { v: 0, x: 2, y: 0 },
        ]}
        edges={[[0, 1]]}
        cols={3}
        rows={1}
        code={DFS}
        lines={LINES}
        label="Dos vértices."
      />,
    );
    expect(screen.getByText(/tienen que ser 0, 1, …, 1 en ese orden/)).toBeInTheDocument();
  });

  it('tells the author when an edge or the start names no vertex', () => {
    const { unmount } = render(
      <GraphWalk
        nodes={TRIANGLE}
        edges={[[0, 5]]}
        cols={3}
        rows={3}
        code={DFS}
        lines={LINES}
        label="x"
      />,
    );
    expect(screen.getByText(/la arista 0-5 nombra un vértice/)).toBeInTheDocument();
    unmount();
    render(
      <GraphWalk
        nodes={TRIANGLE}
        edges={[[0, 1]]}
        start={7}
        cols={3}
        rows={3}
        code={DFS}
        lines={LINES}
        label="x"
      />,
    );
    expect(screen.getByText(/start=7 no es un vértice/)).toBeInTheDocument();
  });

  it('tells the author when there is no listing', () => {
    render(
      <GraphWalk nodes={TRIANGLE} edges={[[0, 1]]} cols={3} rows={3} lines={LINES} label="x" />,
    );
    expect(screen.getByText(/falta el listado/)).toBeInTheDocument();
  });

  it('walks the iterative search with the stack it keeps, not a call stack', async () => {
    render(
      <GraphWalk
        algorithm="dfs-iterative"
        nodes={TRIANGLE}
        edges={[
          [0, 1],
          [0, 2],
          [1, 2],
        ]}
        cols={3}
        rows={3}
        code={ITER}
        lines={ITER_LINES}
        label="Un triángulo."
      />,
    );
    expect(frame()).toHaveAttribute('data-event', 'pushStart');
    expect(screen.getByText('Apila el origen 0.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pila, del fondo al tope: 0.' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Pila de llamadas/ })).toBeNull();
    await forward(1);
    expect(frame()).toHaveAttribute('data-event', 'pop');
    expect(screen.getByRole('img', { name: 'La pila está vacía.' })).toBeInTheDocument();
    await forward(1);
    expect(frame()).toHaveAttribute('data-event', 'mark');
    expect(document.querySelector('[data-hot]')).toHaveAttribute('data-cell', 'visited[0]');
  });

  it('marking on push, paints red the neighbour it skips without having walked to it', async () => {
    render(
      <GraphWalk
        algorithm="dfs-mark-on-push"
        nodes={FAN_NODES}
        edges={FAN_EDGES}
        cols={3}
        rows={3}
        code={ON_PUSH}
        lines={ON_PUSH_LINES}
        label="Un abanico con una cuerda."
      />,
    );
    expect(frame()).toHaveAttribute('data-event', 'markStart');
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    for (let i = 0; i < 40; i++) {
      if (frame().dataset['event'] === 'look' && frame().dataset['v'] === '3') {
        if (frame().dataset['w'] === '1') break;
      }
      await user.click(next);
    }
    expect(frame()).toHaveAttribute('data-w', '1');
    const node1 = document.querySelector('[data-node][data-value="1"]');
    expect(node1).toHaveAttribute('data-tone', 'flag');
    expect(
      screen.getByText(
        'Mira el vecino 1 de 3: está marcado y lo salta, pero el recorrido todavía no pasa por 1.',
      ),
    ).toBeInTheDocument();
  });

  it('tells the author which events of the iterative search have no lines', () => {
    render(
      <GraphWalk
        algorithm="dfs-iterative"
        nodes={TRIANGLE}
        edges={[[0, 1]]}
        cols={3}
        rows={3}
        code={ITER}
        lines={{ pushStart: 2, pop: 4 }}
        label="x"
      />,
    );
    expect(
      screen.getByText(/faltan en lines las líneas de skip, mark, look, prev, push, end/),
    ).toBeInTheDocument();
  });

  it('tells the author which walks exist', () => {
    render(
      <GraphWalk
        // @ts-expect-error -- an author's typo, as MDX would pass it
        algorithm="dijkstra"
        nodes={TRIANGLE}
        edges={[[0, 1]]}
        cols={3}
        rows={3}
        code={ITER}
        lines={LINES}
        label="x"
      />,
    );
    expect(
      screen.getByText(/son dfs, dfs-iterative, dfs-mark-on-push, bfs, bfs-mark-on-pop y kahn/),
    ).toBeInTheDocument();
  });
});

// The walk over a maze's implicit graph (#357 S5b): a dead end down from the
// entrance, the exit at the far corner. Inline listing, numbered from 1.
const MAZE = ['...#', '.#..', '.##.'];

const MAZE_DFS = `private void dfs(int v) {
    visited[v] = true;
    for (int k = 0; k < 4; k++) {
        int r = v / cols + DR4[k];
        int c = v % cols + DC4[k];
        int w = r * cols + c;
        if (free(r, c) && !visited[w]) {
            prev[w] = v;
            dfs(w);
        }
    }
}`;

const MAZE_LINES = { mark: 2, look: [3, 4, 5, 6, 7], prev: 8, recurse: 9, return: 12 };

function maze(extra: Record<string, unknown> = {}) {
  return (
    <GraphWalk grid={MAZE} code={MAZE_DFS} lines={MAZE_LINES} label="Un laberinto." {...extra} />
  );
}

function cell(rc: string): HTMLElement {
  return document.querySelector(`[data-cell="${rc}"]`) as HTMLElement;
}

describe('GraphWalk over a grid', () => {
  it('draws the maze, the walls and the cell its first call marks, with the arrays under the grid', () => {
    render(maze());
    expect(screen.getByText('dfs(0) marca la celda 0, en (0, 0).')).toBeInTheDocument();
    expect(cell('0,0')).toHaveAttribute('data-state', 'running');
    expect(cell('0,3')).toHaveAttribute('data-state', 'wall');
    expect(cell('1,0')).toHaveAttribute('data-state', 'free');
    expect(screen.getByRole('img', { name: /^Un laberinto\. dfs\(0\) marca/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Pila de llamadas: dfs\(0\)/ })).toBeInTheDocument();
    // A cell per square, walls included: the program's arrays, under the grid.
    expect(screen.queryByTestId('stepshow-under')).toBeNull();
    expect(document.querySelector('[data-cell="visited[0]"]')).toHaveTextContent('true');
    expect(document.querySelector('[data-cell="visited[11]"]')).toHaveTextContent('false');
    expect(document.querySelector('[data-cell="prev[3]"]')).toHaveTextContent('−1');
    expect(document.querySelector('[data-thread]')).toHaveAttribute('data-thread', '0');
  });

  it('looks up, off the grid, then down, and walks there: prev written, then the call', async () => {
    render(maze());
    await forward(1);
    expect(frame()).toHaveAttribute('data-event', 'look');
    expect(document.querySelector('[data-look]')).toHaveAttribute('data-look', '-1,0');
    expect(screen.getByText(/fuera de la grilla, y free es false/)).toBeInTheDocument();
    await forward(1);
    expect(document.querySelector('[data-look]')).toHaveAttribute('data-look', '1,0');
    await forward(1);
    expect(frame()).toHaveAttribute('data-event', 'prev');
    expect(document.querySelector('[data-cell="prev[4]"]')).toHaveAttribute('data-hot');
    expect(document.querySelector('[data-cell="prev[4]"]')).toHaveTextContent('0');
    await forward(2);
    expect(frame()).toHaveAttribute('data-event', 'mark');
    expect(cell('1,0')).toHaveAttribute('data-state', 'running');
    expect(cell('0,0')).toHaveAttribute('data-state', 'open');
    // The thread: one line through every call still in progress.
    expect(document.querySelector('[data-thread]')).toHaveAttribute('data-thread', '0,4');
  });

  it('keeps a cell once its call returns, and the thread goes back with the calls', async () => {
    render(maze());
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    while (!(frame().dataset['event'] === 'return' && frame().dataset['v'] === '4')) {
      await user.click(next);
    }
    await user.click(next);
    expect(cell('2,0')).toHaveAttribute('data-state', 'done');
    expect(cell('1,0')).toHaveAttribute('data-state', 'done');
    expect(document.querySelector('[data-thread]')).toHaveAttribute('data-thread', '0');
    expect(cell('0,0')).toHaveAttribute('data-state', 'running');
  });

  it('starts from the cell given as r · C + c', () => {
    render(maze({ start: 11 }));
    expect(screen.getByText('dfs(11) marca la celda 11, en (2, 3).')).toBeInTheDocument();
  });

  it('tells the author a maze is walked by a search only: dfs, dfs-iterative or bfs', () => {
    render(maze({ algorithm: 'kahn' }));
    expect(screen.getByText(/todavía no recorre una grilla/)).toBeInTheDocument();
  });

  it('walks a maze breadth first beside its queue, keeping prev and no dist (#357 arc II)', async () => {
    render(
      maze({
        grid: ['...#', '...#', '#...'],
        algorithm: 'bfs',
        dist: false,
        exit: 11,
        lines: {
          markStart: 1,
          enqueueStart: 2,
          dequeue: 3,
          look: 4,
          mark: 5,
          prev: 6,
          enqueue: 7,
          end: 3,
        },
      }),
    );
    expect(screen.getByTestId('graph-walk-queue')).toBeInTheDocument();
    expect(document.querySelector('[data-cell="prev[0]"]')).not.toBeNull();
    expect(document.querySelector('[data-cell="dist[0]"]')).toBeNull();
    expect(document.querySelector('[data-dist]')).toBeNull();
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    while (next.getAttribute('aria-disabled') !== 'true') {
      await user.click(next);
    }
    // The way back from the exit is the shortest: five steps, not seven.
    expect(document.querySelector('[data-thread]')).toHaveAttribute('data-thread', '0,4,5,9,10,11');
    expect(screen.getByText(/por un camino más corto\.$/)).toBeInTheDocument();
  });

  it("writes each reached cell's distance when the walk keeps dist", () => {
    render(
      maze({
        grid: ['...#', '...#', '#...'],
        algorithm: 'bfs',
        lines: {
          markStart: 1,
          distStart: 2,
          enqueueStart: 3,
          dequeue: 4,
          look: 5,
          mark: 6,
          dist: 7,
          prev: 8,
          enqueue: 9,
          end: 4,
        },
      }),
    );
    expect(screen.getByText('Marca el origen 0.')).toBeInTheDocument();
    expect(document.querySelector('[data-cell="dist[0]"]')).not.toBeNull();
  });

  it('walks a maze with a stack of its own, beside its stack (#357 review round 4)', async () => {
    render(
      maze({
        algorithm: 'dfs-iterative',
        // The iterative walk's own events; the inline listing only has to hold the lines.
        lines: { pushStart: 1, pop: 2, skip: 3, mark: 4, look: 5, prev: 6, push: 7, end: 2 },
      }),
    );
    expect(screen.getByText('Apila el origen 0.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Pila, del fondo al tope: 0\.$/ })).toBeInTheDocument();
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    while (next.getAttribute('aria-disabled') !== 'true') {
      await user.click(next);
    }
    expect(screen.getByTestId('graph-walk-frame')).toHaveAttribute('data-event', 'end');
  });

  it('answers the exit on its last frame, the program lit where it uses visited (#357 review)', async () => {
    render(
      maze({
        algorithm: 'dfs-iterative',
        paths: false,
        exit: 11,
        lines: { pushStart: 1, pop: 2, skip: 3, mark: 4, look: 5, push: 7, end: 2 },
        program: 'boolean[] visited = dfs(grid, 0);\nSystem.out.println(visited[11]);',
        programLines: [1],
        programLinesAtEnd: [2],
      }),
    );
    const program = () =>
      screen
        .getAllByTestId('stepshow-listing')
        .find((l) => l.getAttribute('data-listing') === 'programa')!
        .querySelector('[data-highlight-lines]')!
        .getAttribute('data-highlight-lines');
    expect(program()).toBe('1');
    expect(document.querySelector('[data-cell="prev[0]"]')).toBeNull();
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    while (next.getAttribute('aria-disabled') !== 'true') {
      await user.click(next);
    }
    expect(program()).toBe('2');
    // The way round the walls, by (1, 2) and (1, 3), reaches the exit.
    expect(
      screen.getByText(/visited\[11\], la celda \(2, 3\), es true: se llega a la salida\.$/),
    ).toBeInTheDocument();
  });

  it('keeps the thread off the copies it discards, and ends on the way to the exit (#357 review)', async () => {
    render(
      maze({
        grid: ['...#', '...#', '#...'],
        algorithm: 'dfs-iterative',
        exit: 11,
        lines: { pushStart: 1, pop: 2, skip: 3, mark: 4, look: 5, prev: 6, push: 7, end: 2 },
      }),
    );
    const thread = () => document.querySelector('[data-thread]')!.getAttribute('data-thread')!;
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    let skips = 0;
    while (next.getAttribute('aria-disabled') !== 'true') {
      await user.click(next);
      if (frame().dataset['event'] === 'skip') {
        skips++;
        // A copy popped only to be thrown away is not where the walk is.
        expect(thread().split(',').at(-1)).not.toBe(frame().dataset['v']);
      }
    }
    expect(skips).toBeGreaterThan(0);
    expect(thread()).toBe('0,1,2,6,5,9,10,11');
  });

  it('tells the author when the rows differ in length, hold another character, or start on a wall', () => {
    const { unmount } = render(maze({ grid: ['..', '.'] }));
    expect(screen.getByText(/el mismo largo/)).toBeInTheDocument();
    unmount();
    const second = render(maze({ grid: ['.x'] }));
    expect(screen.getByText(/solo lleva \. \(celda libre\) y # \(muro\)/)).toBeInTheDocument();
    second.unmount();
    render(maze({ start: 3 }));
    expect(screen.getByText(/start=3 no es una celda libre de grid/)).toBeInTheDocument();
  });

  it('tells the author to give a graph or a maze, not both and not neither', () => {
    const { unmount } = render(maze({ nodes: TRIANGLE, edges: [[0, 1]], cols: 3, rows: 3 }));
    expect(screen.getByText(/no los dos/)).toBeInTheDocument();
    unmount();
    render(<GraphWalk code={MAZE_DFS} lines={MAZE_LINES} label="x" />);
    expect(screen.getByText(/falta el grafo/)).toBeInTheDocument();
  });
});

// The breadth-first walks (#357 S10): a diamond, 0 joined to 1 and 2, both
// joined to 3. Inline listings, numbered from 1.
const DIAMOND = [
  { v: 0, x: 1, y: 0 },
  { v: 1, x: 0, y: 1 },
  { v: 2, x: 2, y: 1 },
  { v: 3, x: 1, y: 2 },
];
const DIAMOND_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
];

const BFS = `private void bfs(Graph g, int s) {
    Queue<Integer> queue = new ArrayDeque<>();
    visited[s] = true;
    dist[s] = 0;
    queue.add(s);
    while (!queue.isEmpty()) {
        int v = queue.remove();
        for (int w : g.adj(v)) {
            if (!visited[w]) {
                visited[w] = true;
                dist[w] = dist[v] + 1;
                prev[w] = v;
                queue.add(w);
            }
        }
    }
}`;

const BFS_LINES = {
  markStart: 3,
  distStart: 4,
  enqueueStart: [2, 5],
  dequeue: [6, 7],
  look: [8, 9],
  mark: 10,
  dist: 11,
  prev: 12,
  enqueue: 13,
  end: 6,
};

const ON_POP = `private void bfs(Graph g, int s) {
    Queue<Integer> queue = new ArrayDeque<>();
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

async function stepTo(done: () => boolean, limit = 80) {
  const user = userEvent.setup();
  const next = screen.getByRole('button', { name: /adelante/i });
  for (let i = 0; i < limit && !done(); i++) await user.click(next);
}

describe('GraphWalk, breadth first', () => {
  it('draws the queue beside the graph and dist under the listing', async () => {
    render(
      <GraphWalk
        algorithm="bfs"
        nodes={DIAMOND}
        edges={DIAMOND_EDGES}
        cols={3}
        rows={3}
        code={BFS}
        lines={BFS_LINES}
        label="Un rombo."
      />,
    );
    expect(frame()).toHaveAttribute('data-event', 'markStart');
    expect(screen.getByRole('img', { name: 'La cola está vacía.' })).toBeInTheDocument();
    expect(document.querySelector('[data-cell="dist[0]"]')).not.toBeNull();
    await forward(1);
    expect(document.querySelector('[data-hot]')).toHaveAttribute('data-cell', 'dist[0]');
    await forward(1);
    expect(screen.getByRole('img', { name: 'Cola, del frente al final: 0.' })).toBeInTheDocument();
  });

  it('draws the arrays under the graph instead, with arraysAt="drawing" (#357 review)', () => {
    render(
      <GraphWalk
        algorithm="bfs"
        nodes={DIAMOND}
        edges={DIAMOND_EDGES}
        cols={3}
        rows={3}
        code={BFS}
        lines={BFS_LINES}
        label="Un rombo."
        arraysAt="drawing"
      />,
    );
    expect(screen.queryByTestId('stepshow-under')).toBeNull();
    expect(frame().querySelector('[data-cell="dist[0]"]')).not.toBeNull();
  });

  it('writes each vertex its distance as it enqueues it, and keeps it beside the vertex', async () => {
    render(
      <GraphWalk
        algorithm="bfs"
        nodes={DIAMOND}
        edges={DIAMOND_EDGES}
        cols={3}
        rows={3}
        code={BFS}
        lines={BFS_LINES}
        label="Un rombo."
      />,
    );
    await stepTo(() => frame().dataset['event'] === 'dist' && frame().dataset['w'] === '3');
    expect(screen.getByText('dist[3] = dist[1] + 1 = 2.')).toBeInTheDocument();
    expect(document.querySelector('[data-hot]')).toHaveAttribute('data-cell', 'dist[3]');
    await stepTo(() => frame().dataset['event'] === 'end');
    expect(
      screen.getByText('La cola quedó vacía: marcó todo lo que se alcanza desde 0.'),
    ).toBeInTheDocument();
  });

  it('marking on dequeue, paints red a vertex enqueued while already in the queue', async () => {
    render(
      <GraphWalk
        algorithm="bfs-mark-on-pop"
        nodes={DIAMOND}
        edges={DIAMOND_EDGES}
        cols={3}
        rows={3}
        code={ON_POP}
        lines={ON_POP_LINES}
        label="Un rombo."
      />,
    );
    await stepTo(
      () =>
        frame().dataset['event'] === 'enqueue' &&
        frame().dataset['v'] === '2' &&
        frame().dataset['w'] === '3',
    );
    expect(screen.getByText('Encola 3 por segunda vez: ya estaba en la cola.')).toBeInTheDocument();
    expect(document.querySelector('[data-node][data-value="3"]')).toHaveAttribute(
      'data-tone',
      'flag',
    );
    // The tempting version keeps neither dist nor prev.
    expect(document.querySelector('[data-cell="prev[0]"]')).toBeNull();
    expect(document.querySelector('[data-cell="dist[0]"]')).toBeNull();
  });
});

// Kahn's walk (#357 S15), on a malla with a cycle: 0 → 1, 1 → 2, 2 → 1.
const KAHN = `int[] inDegree = Graphs.inDegrees(g);
Queue<Integer> sources = new ArrayDeque<>();
for (int v = 0; v < g.V(); v++) {
    if (inDegree[v] == 0) {
        sources.add(v);
    }
}
while (!sources.isEmpty()) {
    int v = sources.remove();
    order.add(v);
    for (int w : g.adj(v)) {
        inDegree[w]--;
        if (inDegree[w] == 0) {
            sources.add(w);
        }
    }
}`;

const KAHN_LINES = {
  inDegrees: 1,
  check: [3, 4],
  enqueueStart: [4, 5],
  dequeue: [8, 9],
  append: 10,
  lower: [11, 12],
  enqueue: [13, 14],
  end: 8,
};

const CHAIN = [
  { v: 0, x: 0, y: 0 },
  { v: 1, x: 2, y: 0 },
  { v: 2, x: 4, y: 0 },
];

describe('GraphWalk, Kahn', () => {
  it('draws the in-degrees and the order under the listing, and the line under the graph', async () => {
    render(
      <GraphWalk
        algorithm="kahn"
        directed
        nodes={CHAIN}
        edges={[
          [0, 1],
          [1, 2],
        ]}
        cols={5}
        rows={1}
        code={KAHN}
        lines={KAHN_LINES}
        label="Tres ramos en fila."
      />,
    );
    expect(frame()).toHaveAttribute('data-event', 'inDegrees');
    expect(document.querySelector('[data-cell="inDegree[1]"]')).not.toBeNull();
    expect(document.querySelector('[data-cell="visited[0]"]')).toBeNull();
    expect(screen.getByRole('img', { name: 'La línea está vacía.' })).toBeInTheDocument();
    await stepTo(() => frame().dataset['event'] === 'end');
    expect(
      screen.getByRole('img', { name: 'La línea, de izquierda a derecha: 0, 1, 2.' }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('[data-bow][data-right]')).toHaveLength(2);
  });

  it('paints red the vertices a cycle leaves off the line', async () => {
    render(
      <GraphWalk
        algorithm="kahn"
        directed
        nodes={CHAIN}
        edges={[
          [0, 1],
          [1, 2],
          [2, 1],
        ]}
        cols={5}
        rows={1}
        code={KAHN}
        lines={KAHN_LINES}
        label="Tres ramos, dos en ciclo."
      />,
    );
    await stepTo(() => frame().dataset['event'] === 'end');
    expect(screen.getByText(/1 de 3 vértices en la línea/)).toBeInTheDocument();
    expect(document.querySelector('[data-node][data-value="1"]')).toHaveAttribute(
      'data-tone',
      'flag',
    );
    expect(document.querySelector('[data-node][data-value="2"]')).toHaveAttribute(
      'data-tone',
      'flag',
    );
  });

  it('tells the author Kahn orders a directed graph', () => {
    render(
      <GraphWalk
        algorithm="kahn"
        nodes={CHAIN}
        edges={[[0, 1]]}
        cols={5}
        rows={1}
        code={KAHN}
        lines={KAHN_LINES}
        label="x"
      />,
    );
    expect(screen.getByText(/kahn ordena un grafo dirigido/)).toBeInTheDocument();
  });
});

describe('GraphWalk without paths', () => {
  it('needs no prev line and draws only visited under the listing', async () => {
    render(
      <GraphWalk
        paths={false}
        nodes={TRIANGLE}
        edges={[
          [0, 1],
          [0, 2],
          [1, 2],
        ]}
        cols={3}
        rows={3}
        code={DFS}
        lines={{ mark: 2, look: [3, 4], recurse: 6, return: 9 }}
        label="Un triángulo."
      />,
    );
    expect(document.querySelector('[data-authoring-error]')).toBeNull();
    expect(document.querySelector('[data-cell="visited[0]"]')).not.toBeNull();
    expect(document.querySelector('[data-cell="prev[0]"]')).toBeNull();
    await stepTo(() => frame().dataset['event'] === 'return' && frame().dataset['v'] === '0');
    expect(
      screen.getByText('dfs(0) termina: marcó todo lo que se alcanza desde 0.'),
    ).toBeInTheDocument();
  });
});

describe('GraphWalk caption', () => {
  it('writes the caption under every frame', async () => {
    render(
      <GraphWalk
        nodes={TRIANGLE}
        edges={[
          [0, 1],
          [0, 2],
          [1, 2],
        ]}
        cols={3}
        rows={3}
        code={DFS}
        lines={LINES}
        label="Un triángulo."
        caption="0 Ana · 1 Beto · 2 Carla"
      />,
    );
    expect(screen.getByTestId('graph-walk-caption')).toHaveTextContent('0 Ana · 1 Beto · 2 Carla');
    await forward(2);
    expect(screen.getByTestId('graph-walk-caption')).toHaveTextContent('0 Ana · 1 Beto · 2 Carla');
  });
});
