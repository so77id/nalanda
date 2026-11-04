import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { PenTrace, type PenTraceProps } from './PenTrace';

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

  it('tells the author when the label is missing', () => {
    const { container } = render(<PenTrace {...KITE} label="" />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when a stroke names a point that is not drawn', () => {
    const { container } = render(<PenTrace {...KITE} edges={[['A', 'Z']]} />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});
