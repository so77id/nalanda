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
        '    static void dfs(Graph g, int v, boolean[] marked, int[] prev) {',
        '        marked[v] = true;',
        '        for (int w : g.adj(v)) {',
        '            if (!marked[w]) {',
        '                prev[w] = v;',
        '                dfs(g, w, marked, prev);',
        '            }',
        '        }',
        '    }',
        '}',
        '',
      ].join('\n'),
    })[src] ?? null,
}));

const DFS = `static void dfs(Graph g, int v, boolean[] marked, int[] prev) {
    marked[v] = true;
    for (int w : g.adj(v)) {
        if (!marked[w]) {
            prev[w] = v;
            dfs(g, w, marked, prev);
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
        if (marked[v]) {
            continue;
        }
        marked[v] = true;
        for (int w : g.adj(v)) {
            if (!marked[w]) {
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
      screen.getByRole('img', { name: 'marked: true, false, false; prev: −1, −1, −1' }),
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
      screen.getByRole('img', { name: 'marked: true, false, false; prev: −1, 0, −1' }),
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
    expect(screen.getByTestId('stepshow-under')).toHaveTextContent('marked');
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
    expect(document.querySelector('[data-hot]')).toHaveAttribute('data-cell', 'marked[0]');
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
        algorithm="bfs"
        nodes={TRIANGLE}
        edges={[[0, 1]]}
        cols={3}
        rows={3}
        code={ITER}
        lines={LINES}
        label="x"
      />,
    );
    expect(screen.getByText(/son dfs, dfs-iterative y dfs-mark-on-push/)).toBeInTheDocument();
  });
});

// The walk over a maze's implicit graph (#357 S5b): a dead end down from the
// entrance, the exit at the far corner. Inline listing, numbered from 1.
const MAZE = ['...#', '.#..', '.##.'];

const MAZE_DFS = `private void dfs(int v) {
    marked[v] = true;
    for (int k = 0; k < 4; k++) {
        int r = v / cols + DR4[k];
        int c = v % cols + DC4[k];
        int w = r * cols + c;
        if (free(r, c) && !marked[w]) {
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
  it('draws the maze, the walls and the cell its first call marks, with no arrays under the listing', () => {
    render(maze());
    expect(screen.getByText('dfs(0) marca la celda 0, en (0, 0).')).toBeInTheDocument();
    expect(cell('0,0')).toHaveAttribute('data-state', 'running');
    expect(cell('0,3')).toHaveAttribute('data-state', 'wall');
    expect(cell('1,0')).toHaveAttribute('data-state', 'free');
    expect(screen.getByRole('img', { name: /^Un laberinto\. dfs\(0\) marca/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Pila de llamadas: dfs\(0\)/ })).toBeInTheDocument();
    expect(document.querySelector('[data-cell="marked[0]"]')).toBeNull();
  });

  it('looks up, off the grid, then down, and walks there: prev as an arrow back, then the call', async () => {
    render(maze());
    await forward(1);
    expect(frame()).toHaveAttribute('data-event', 'look');
    expect(document.querySelector('[data-look]')).toHaveAttribute('data-look', '-1,0');
    expect(screen.getByText(/fuera de la grilla, y free es false/)).toBeInTheDocument();
    await forward(1);
    expect(document.querySelector('[data-look]')).toHaveAttribute('data-look', '1,0');
    await forward(1);
    expect(frame()).toHaveAttribute('data-event', 'prev');
    expect(document.querySelector('[data-prev="4"]')).toHaveAttribute('data-hot');
    await forward(2);
    expect(frame()).toHaveAttribute('data-event', 'mark');
    expect(cell('1,0')).toHaveAttribute('data-state', 'running');
    expect(cell('0,0')).toHaveAttribute('data-state', 'open');
    // The thread: the arrow of every call still in progress stays lit.
    expect(document.querySelector('[data-prev="4"]')).toHaveAttribute('data-hot');
  });

  it('keeps a cell once its call returns, and its arrow goes back to ink', async () => {
    render(maze());
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /adelante/i });
    while (!(frame().dataset['event'] === 'return' && frame().dataset['v'] === '4')) {
      await user.click(next);
    }
    await user.click(next);
    expect(cell('2,0')).toHaveAttribute('data-state', 'done');
    expect(cell('1,0')).toHaveAttribute('data-state', 'done');
    expect(document.querySelector('[data-prev="8"]')).not.toHaveAttribute('data-hot');
    expect(cell('0,0')).toHaveAttribute('data-state', 'running');
  });

  it('starts from the cell given as r · C + c', () => {
    render(maze({ start: 11 }));
    expect(screen.getByText('dfs(11) marca la celda 11, en (2, 3).')).toBeInTheDocument();
  });

  it('tells the author a maze is walked by dfs only, for now', () => {
    render(maze({ algorithm: 'dfs-iterative' }));
    expect(screen.getByText(/todavía no recorre una grilla/)).toBeInTheDocument();
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
