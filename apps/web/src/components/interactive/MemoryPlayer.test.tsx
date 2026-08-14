import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { TraceStep } from './trace';
import { MemoryPlayer } from './MemoryPlayer';

const SOURCE = ['Punto a = new Punto(1, 2);', 'Punto b = a;', 'b.mover(99);'].join('\n');

const at = (line: number, vars: [string, number][]): TraceStep => ({
  line,
  frame: 'main',
  frames: [
    { name: 'main', variables: vars.map(([name, id]) => ({ name, value: { kind: 'ref', id } })) },
  ],
  objects: [{ id: 1, kind: 'object', type: 'Punto', fields: [] }],
  truncated: null,
});

const steps = [
  at(1, [['a', 1]]),
  at(2, [
    ['a', 1],
    ['b', 1],
  ]),
  at(3, [
    ['a', 1],
    ['b', 1],
  ]),
];

describe('MemoryPlayer', () => {
  it('starts on the first photograph and says where it is', () => {
    render(<MemoryPlayer steps={steps} source={SOURCE} />);

    expect(screen.getByText('paso 1 de 3')).toBeInTheDocument();
  });

  it('walks forward and back with the buttons', async () => {
    const user = userEvent.setup();
    render(<MemoryPlayer steps={steps} source={SOURCE} />);

    await user.click(screen.getByRole('button', { name: 'Paso siguiente' }));
    expect(screen.getByText('paso 2 de 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Paso anterior' }));
    expect(screen.getByText('paso 1 de 3')).toBeInTheDocument();
  });

  it('stops at both ends instead of wrapping around', async () => {
    const user = userEvent.setup();
    render(<MemoryPlayer steps={steps} source={SOURCE} />);

    const back = screen.getByRole('button', { name: 'Paso anterior' });
    const forward = screen.getByRole('button', { name: 'Paso siguiente' });

    expect(back).toHaveAttribute('aria-disabled', 'true');
    await user.click(back);
    expect(screen.getByText('paso 1 de 3')).toBeInTheDocument();

    await user.click(forward);
    await user.click(forward);
    await user.click(forward);

    expect(screen.getByText('paso 3 de 3')).toBeInTheDocument();
    expect(forward).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps walking with the keyboard after reaching an end', async () => {
    // A `disabled` button cannot hold focus: walking to the last step used to
    // throw focus to the body, and the reader could no longer walk back with the
    // arrows — stranded by the very control they had just used.
    const user = userEvent.setup();
    render(<MemoryPlayer steps={steps} source={SOURCE} />);

    await user.click(screen.getByRole('button', { name: 'Paso siguiente' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('paso 3 de 3')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('paso 2 de 3')).toBeInTheDocument();
  });

  it('can be walked from the group itself, without touching a button', async () => {
    const user = userEvent.setup();
    render(<MemoryPlayer steps={steps} source={SOURCE} />);

    await user.tab();
    expect(screen.getByRole('group')).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('paso 2 de 3')).toBeInTheDocument();
  });

  it('marks the line that produced the photograph, and only that one', async () => {
    const user = userEvent.setup();
    const { container } = render(<MemoryPlayer steps={steps} source={SOURCE} />);

    const active = () => [...container.querySelectorAll('[data-active="true"]')];
    expect(active()).toHaveLength(1);
    expect(active()[0]).toHaveTextContent('Punto a = new Punto(1, 2);');

    await user.click(screen.getByRole('button', { name: 'Paso siguiente' }));
    expect(active()[0]).toHaveTextContent('Punto b = a;');
  });

  it('announces each step in Spanish for a reader who cannot see the drawing', async () => {
    const user = userEvent.setup();
    render(<MemoryPlayer steps={steps} source={SOURCE} />);

    const live = screen.getByRole('status');
    expect(live).toHaveTextContent(/paso 1 de 3/i);

    await user.click(screen.getByRole('button', { name: 'Paso siguiente' }));
    // Not just the counter: the state itself, or the announcement says nothing
    // about what changed.
    expect(live).toHaveTextContent(/a y b apuntan al mismo objeto/i);
  });

  it('says a run was cut short rather than presenting it as complete', () => {
    render(<MemoryPlayer steps={steps} source={SOURCE} truncated="pasos" />);

    expect(screen.getByText(/se alcanzó el máximo/i)).toBeInTheDocument();
  });

  it('renders nothing to step through when the run produced no photographs', () => {
    render(<MemoryPlayer steps={[]} source={SOURCE} />);

    expect(screen.queryByRole('button', { name: 'Paso siguiente' })).not.toBeInTheDocument();
  });
});
