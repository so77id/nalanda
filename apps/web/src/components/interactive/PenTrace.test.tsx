import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModeProvider } from '../../presentation';
import { ATTEMPTS, PenTrace, STEP_MS, type PenTraceProps } from './PenTrace';

/** A triangle A, B, C with a tail C–D: it can be traced from D, ending at C. */
const KITE: PenTraceProps = {
  cols: 3,
  rows: 3,
  nodes: [
    { v: 'A', x: 0, y: 0 },
    { v: 'B', x: 2, y: 0 },
    { v: 'C', x: 1, y: 1 },
    { v: 'D', x: 1, y: 2 },
  ],
  edges: [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
    ['C', 'D'],
  ],
  label: 'Un triángulo con una cola.',
};

/** A triangle alone: every tracing ends where it began. */
const TRIANGLE: PenTraceProps = { ...KITE, edges: KITE.edges.slice(0, 3) };

/** Four points, each joined to the other three: four odd points, no solution. */
const SQUARE_WITH_DIAGONALS: PenTraceProps = {
  ...KITE,
  edges: [
    ['A', 'B'],
    ['A', 'C'],
    ['A', 'D'],
    ['B', 'C'],
    ['B', 'D'],
    ['C', 'D'],
  ],
};

afterEach(() => {
  vi.useRealTimers();
});

/** Let `n` steps of a solution go by: each one is scheduled after the last renders. */
const tick = (n: number) => {
  for (let i = 0; i < n; i++) act(() => vi.advanceTimersByTime(STEP_MS));
};

const press = (...points: string[]) => {
  for (const p of points) fireEvent.click(screen.getByRole('button', { name: `Punto ${p}` }));
};
const said = () => screen.getByRole('status').textContent;
const drawn = (c: HTMLElement) => c.querySelectorAll('[data-stroke][data-drawn]').length;
const statusOf = (c: HTMLElement) =>
  c.querySelector('[data-pen-trace]')!.getAttribute('data-status');

describe('PenTrace', () => {
  it('is a group named by its label, with every point a button', () => {
    render(<PenTrace {...KITE} />);
    expect(screen.getByRole('group', { name: 'Un triángulo con una cola.' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Punto / })).toHaveLength(4);
  });

  it('asks for a starting point before the pen goes down', () => {
    const { container } = render(<PenTrace {...KITE} />);
    expect(said()).toBe('Elijamos un punto para bajar el lápiz.');
    expect(statusOf(container)).toBe('empty');
  });

  it('draws a stroke from point to point and counts what is left', () => {
    const { container } = render(<PenTrace {...KITE} />);
    press('A', 'B');
    expect(drawn(container)).toBe(1);
    expect(said()).toBe('Quedan 3 trazos por dibujar.');
    expect(screen.getByText('trazos: 1 / 4')).toBeTruthy();
  });

  it('refuses a jump and says why, drawing nothing', () => {
    const { container } = render(<PenTrace {...KITE} />);
    press('A', 'D');
    expect(drawn(container)).toBe(0);
    expect(said()).toBe(
      'Hasta ese punto no hay un trazo libre: el lápiz no salta ni repite un trazo.',
    );
  });

  it('says when it is stuck', () => {
    const { container } = render(<PenTrace {...KITE} />);
    press('A', 'B', 'C', 'A');
    expect(statusOf(container)).toBe('stuck');
    expect(said()).toBe('Sin salida: queda un trazo y ninguno sale de este punto.');
  });

  it('says when it is done, and that it ends at another point', () => {
    const { container } = render(<PenTrace {...KITE} />);
    press('D', 'C', 'A', 'B', 'C');
    expect(statusOf(container)).toBe('done');
    expect(said()).toBe('Figura completa, sin levantar el lápiz. Termina en otro punto.');
  });

  it('says when a finished tracing ends where it began', () => {
    render(<PenTrace {...TRIANGLE} />);
    press('A', 'B', 'C', 'A');
    expect(said()).toBe('Figura completa, sin levantar el lápiz. Termina donde empezó.');
  });

  it('rings the point where the pen went down, and marks the one it is on', () => {
    const { container } = render(<PenTrace {...KITE} />);
    press('A', 'B');
    expect(container.querySelector('[data-start]')!.getAttribute('data-point')).toBe('A');
    expect(container.querySelector('[data-current]')!.getAttribute('data-point')).toBe('B');
  });

  it('undoes the last stroke, and starts again from nothing', () => {
    const { container } = render(<PenTrace {...KITE} />);
    press('A', 'B', 'C');
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(drawn(container)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }));
    expect(drawn(container)).toBe(0);
    expect(statusOf(container)).toBe('empty');
  });

  it('numbers each drawn stroke by the step that drew it, on a lettered graph', () => {
    const { container } = render(<PenTrace {...KITE} />);
    press('D', 'C', 'A');
    const steps = [...container.querySelectorAll('[data-step]')].map((g) => [
      g.getAttribute('data-step'),
      g.getAttribute('data-of'),
    ]);
    expect(steps).toEqual([
      ['1', '3'],
      ['2', '2'],
    ]);
  });

  it('marks the last stroke drawn', () => {
    const { container } = render(<PenTrace {...KITE} />);
    press('D', 'C', 'A');
    const last = container.querySelectorAll('[data-stroke][data-last]');
    expect(last).toHaveLength(1);
    expect(last[0].getAttribute('data-stroke')).toBe('2');
  });

  it('writes the points below in the order the pen visits them', () => {
    const { container } = render(<PenTrace {...KITE} />);
    const order = () => container.querySelector('[data-trace-order]')!.textContent!.trim();
    expect(order()).toBe('');
    press('D', 'C', 'A');
    expect(order()).toBe('D → C → A');
  });

  it('keeps a figure without step numbers or the order of its points', () => {
    const { container } = render(<PenTrace {...KITE} figure />);
    press('D', 'C', 'A');
    expect(container.querySelector('[data-step]')).toBeNull();
    expect(container.querySelector('[data-trace-order]')).toBeNull();
    expect(container.querySelector('[data-stroke][data-last]')).not.toBeNull();
  });

  it('presses a point from the keyboard', () => {
    const { container } = render(<PenTrace {...KITE} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Punto C' }), { key: 'Enter' });
    expect(container.querySelector('[data-current]')!.getAttribute('data-point')).toBe('C');
  });

  it('draws a figure as unlabelled dots, and a graph as lettered vertices', () => {
    const figure = render(<PenTrace {...KITE} figure />).container;
    expect(figure.querySelector('[data-point="A"] text')).toBeNull();
    const graph = render(<PenTrace {...KITE} />).container;
    expect(graph.querySelector('[data-point="A"] text')!.textContent).toBe('A');
  });

  it('draws the same in the book and on a slide', () => {
    const book = render(
      <ModeProvider mode="book">
        <PenTrace {...KITE} />
      </ModeProvider>,
    ).container.innerHTML;
    const slide = render(
      <ModeProvider mode="presentation">
        <PenTrace {...KITE} />
      </ModeProvider>,
    ).container.innerHTML;
    expect(slide).toBe(book);
  });

  it('offers to solve only when the figure asks for it', () => {
    render(<PenTrace {...KITE} />);
    expect(screen.queryByRole('button', { name: /Resolver/ })).toBeNull();
  });

  it('draws a solution stroke by stroke, from the point it starts at', () => {
    vi.useFakeTimers();
    const { container } = render(<PenTrace {...KITE} solvable />);
    fireEvent.click(screen.getByRole('button', { name: /Resolver/ }));
    tick(1);
    expect(container.querySelector('[data-start]')).not.toBeNull();
    expect(drawn(container)).toBe(0);
    tick(1);
    expect(drawn(container)).toBe(1);
    tick(KITE.edges.length);
    expect(statusOf(container)).toBe('done');
    expect(drawn(container)).toBe(KITE.edges.length);
    expect(said()).toMatch(/^Figura completa/);
  });

  it('says at once when a figure cannot be drawn in one stroke', () => {
    const { container } = render(<PenTrace {...SQUARE_WITH_DIAGONALS} solvable />);
    fireEvent.click(screen.getByRole('button', { name: /Resolver/ }));
    expect(said()).toBe('Esta figura no se puede dibujar de un solo trazo, empiece donde empiece.');
    expect(drawn(container)).toBe(0);
  });

  it('loops through failed attempts when there is none, keeping the message', () => {
    vi.useFakeTimers();
    const { container } = render(<PenTrace {...SQUARE_WITH_DIAGONALS} solvable />);
    fireEvent.click(screen.getByRole('button', { name: /Resolver/ }));
    tick(3);
    expect(drawn(container)).toBeGreaterThan(0);
    expect(said()).toBe('Esta figura no se puede dibujar de un solo trazo, empiece donde empiece.');
    const starts = new Set<string>();
    for (let i = 0; i < 80; i++) {
      tick(1);
      const start = container.querySelector('[data-start]')?.getAttribute('data-point');
      if (start) starts.add(start);
      if (statusOf(container) === 'done') throw new Error('an attempt drew every stroke');
    }
    expect(starts.size).toBe(Math.min(ATTEMPTS, 4));
    expect(said()).toBe('Esta figura no se puede dibujar de un solo trazo, empiece donde empiece.');
  });

  it('ignores the points while it shows a solution', () => {
    vi.useFakeTimers();
    const { container } = render(<PenTrace {...KITE} solvable />);
    fireEvent.click(screen.getByRole('button', { name: /Resolver/ }));
    tick(2);
    const before = drawn(container);
    press('A', 'B', 'C', 'D');
    expect(drawn(container)).toBe(before);
  });

  it('stops the failed attempts at a press, drops the message and goes on by hand', () => {
    vi.useFakeTimers();
    const { container } = render(<PenTrace {...SQUARE_WITH_DIAGONALS} solvable />);
    fireEvent.click(screen.getByRole('button', { name: /Resolver/ }));
    tick(4);
    press('A');
    expect(container.querySelector('[data-start]')?.getAttribute('data-point')).toBe('A');
    expect(drawn(container)).toBe(0);
    expect(said()).toBe('Quedan 6 trazos por dibujar.');
    tick(10);
    expect(drawn(container)).toBe(0);
    press('B');
    expect(drawn(container)).toBe(1);
  });

  it('keeps searching on a question still open, never saying whether a tracing exists', () => {
    vi.useFakeTimers();
    const { container } = render(<PenTrace {...SQUARE_WITH_DIAGONALS} keepTrying />);
    expect(screen.queryByRole('button', { name: /Resolver/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Buscar solución/ }));
    tick(3);
    expect(drawn(container)).toBeGreaterThan(0);
    const starts = new Set<string>();
    for (let i = 0; i < 80; i++) {
      tick(1);
      expect(said()).not.toMatch(/no se puede/);
      const start = container.querySelector('[data-start]')?.getAttribute('data-point');
      if (start) starts.add(start);
    }
    expect(starts.size).toBe(Math.min(ATTEMPTS, 4));
  });

  it('stops searching at a press, and goes on by hand from that point', () => {
    vi.useFakeTimers();
    const { container } = render(<PenTrace {...SQUARE_WITH_DIAGONALS} keepTrying />);
    fireEvent.click(screen.getByRole('button', { name: /Buscar solución/ }));
    tick(5);
    press('C');
    expect(container.querySelector('[data-start]')?.getAttribute('data-point')).toBe('C');
    expect(said()).toBe('Quedan 6 trazos por dibujar.');
    tick(10);
    expect(drawn(container)).toBe(0);
  });

  it('tells the author when a figure asks both to be solved and to be searched', () => {
    const { container } = render(<PenTrace {...KITE} solvable keepTrying />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('starts again from nothing, stopping a solution under way', () => {
    vi.useFakeTimers();
    const { container } = render(<PenTrace {...KITE} solvable />);
    fireEvent.click(screen.getByRole('button', { name: /Resolver/ }));
    tick(2);
    fireEvent.click(screen.getByRole('button', { name: /Empezar de nuevo/ }));
    tick(10);
    expect(statusOf(container)).toBe('empty');
    expect(drawn(container)).toBe(0);
  });

  it('tells the author when the label is missing', () => {
    const { container } = render(<PenTrace {...KITE} label="" />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when a stroke names a point that is not drawn', () => {
    const { container } = render(<PenTrace {...KITE} edges={[['A', 'Z']]} />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});

// PenTrace loads lazily, so app/contentRenders.test.tsx paints its Suspense
// fallback and never sees an authoring error a mount would show: each one
// 25-grafos-introduccion mounts is pinned here, named by its slide.
const STAR: PenTraceProps = {
  figure: true,
  solvable: true,
  cols: 4,
  rows: 4,
  nodes: [
    { v: 'A', x: 2, y: 0 },
    { v: 'B', x: 3.902, y: 1.239 },
    { v: 'C', x: 3.176, y: 3.244 },
    { v: 'D', x: 0.824, y: 3.244 },
    { v: 'E', x: 0.098, y: 1.239 },
    { v: 'F', x: 2.449, y: 1.239 },
    { v: 'G', x: 2.727, y: 2.005 },
    { v: 'H', x: 2.0, y: 2.478 },
    { v: 'I', x: 1.273, y: 2.005 },
    { v: 'J', x: 1.551, y: 1.239 },
  ],
  edges: [
    ['A', 'F'],
    ['F', 'G'],
    ['G', 'C'],
    ['B', 'G'],
    ['G', 'H'],
    ['H', 'D'],
    ['C', 'H'],
    ['H', 'I'],
    ['I', 'E'],
    ['D', 'I'],
    ['I', 'J'],
    ['J', 'A'],
    ['E', 'J'],
    ['J', 'F'],
    ['F', 'B'],
  ],
  label: 'La estrella de cinco puntas, para dibujar de un solo trazo.',
};
const HOUSE: PenTraceProps = {
  figure: true,
  solvable: true,
  cols: 3,
  rows: 4,
  nodes: [
    { v: 'A', x: 1, y: 0 },
    { v: 'B', x: 0, y: 1 },
    { v: 'C', x: 2, y: 1 },
    { v: 'F', x: 1, y: 2 },
    { v: 'D', x: 0, y: 3 },
    { v: 'E', x: 2, y: 3 },
  ],
  edges: [
    ['A', 'B'],
    ['A', 'C'],
    ['B', 'C'],
    ['B', 'D'],
    ['C', 'E'],
    ['D', 'E'],
    ['B', 'F'],
    ['F', 'E'],
    ['C', 'F'],
    ['F', 'D'],
  ],
  label: 'La casa: un cuadrado con sus dos diagonales y un techo, para dibujar de un solo trazo.',
};
const ENVELOPE: PenTraceProps = {
  figure: true,
  solvable: true,
  cols: 3,
  rows: 3,
  nodes: [
    { v: 'A', x: 0, y: 0 },
    { v: 'B', x: 2, y: 0 },
    { v: 'E', x: 1, y: 1 },
    { v: 'C', x: 0, y: 2 },
    { v: 'D', x: 2, y: 2 },
  ],
  edges: [
    ['A', 'B'],
    ['C', 'D'],
    ['A', 'C'],
    ['B', 'D'],
    ['A', 'E'],
    ['E', 'D'],
    ['B', 'E'],
    ['E', 'C'],
  ],
  label: 'El sobre: un rectángulo con sus dos diagonales, para dibujar de un solo trazo.',
};
const KONIGSBERG: PenTraceProps = {
  cols: 3,
  rows: 3,
  nodes: [
    { v: 'B', x: 1, y: 0 },
    { v: 'A', x: 0, y: 1 },
    { v: 'D', x: 2, y: 1 },
    { v: 'C', x: 1, y: 2 },
  ],
  edges: [
    ['A', 'B'],
    ['A', 'B'],
    ['A', 'C'],
    ['A', 'C'],
    ['A', 'D'],
    ['B', 'D'],
    ['C', 'D'],
  ],
  label:
    'Königsberg como puntos y líneas: cuatro puntos, A, B, C y D, y siete líneas. Dos líneas unen A con B, dos unen A con C, y una une A con D, B con D y C con D. Para recorrerlas todas sin pasar dos veces por la misma.',
};

const KONIGSBERG_WALK: PenTraceProps = { ...KONIGSBERG, keepTrying: true };

const KONIGSBERG_PLUS_BC: PenTraceProps = {
  ...KONIGSBERG,
  solvable: true,
  edges: [...KONIGSBERG.edges, ['B', 'C']],
  label:
    'Königsberg con un octavo puente entre B y C, para recorrer cada arista una sola vez. Tiene dos vértices impares, A y D.',
};
const KONIGSBERG_PLUS_BC_AD: PenTraceProps = {
  ...KONIGSBERG_PLUS_BC,
  edges: [...KONIGSBERG_PLUS_BC.edges, ['A', 'D']],
  label:
    'Königsberg con dos puentes más, entre B y C y entre A y D, para recorrer cada arista una sola vez. No tiene vértices impares.',
};

describe('the combinations 25-grafos-introduccion mounts', () => {
  it.each([
    ['Una figura de un solo trazo · la estrella', STAR, 15],
    ['Una figura de un solo trazo · la casa', HOUSE, 10],
    ['Una figura de un solo trazo · el sobre', ENVELOPE, 8],
    ['El paseo por Königsberg · Königsberg', KONIGSBERG_WALK, 7],
    ['Königsberg con más puentes · un puente más', KONIGSBERG_PLUS_BC, 8],
    ['Königsberg con más puentes · dos puentes más', KONIGSBERG_PLUS_BC_AD, 9],
  ] as const)('%s', (_slide, props, strokes) => {
    const { container } = render(<PenTrace {...props} />);
    expect(container.querySelector('[data-authoring-error]')).toBeNull();
    expect(container.querySelectorAll('[data-stroke]')).toHaveLength(strokes);
  });
});
