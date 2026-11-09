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
});
