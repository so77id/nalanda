import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CallStack } from './CallStack';

describe('CallStack', () => {
  it('shows an authoring error when `recipe` is missing', () => {
    render(<CallStack arg={3} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.getByText('recipe')).toBeInTheDocument();
  });

  it('shows an authoring error when the recipe is unknown', () => {
    render(<CallStack recipe="mystery" arg={3} />);
    expect(screen.getByText(/no es una receta conocida/i)).toBeInTheDocument();
  });

  it('shows an authoring error when `arg` is missing or invalid', () => {
    render(<CallStack recipe="factorial" />);
    expect(screen.getByText(/entero no negativo/i)).toBeInTheDocument();
  });

  it('shows an authoring error when `arg` is negative', () => {
    render(<CallStack recipe="factorial" arg={-1} />);
    expect(screen.getByText(/entero no negativo/i)).toBeInTheDocument();
  });

  it('starts pausado at step 0 with an empty stack', () => {
    render(<CallStack recipe="factorial" arg={3} />);
    // Empty state hint is visible.
    expect(screen.getByText(/click en/i)).toBeInTheDocument();
    // No frames rendered.
    expect(screen.queryAllByTestId('callstack-frame')).toHaveLength(0);
    // Step counter reads 0.
    expect(screen.getByText(/paso 0 \/ /i)).toBeInTheDocument();
  });

  it('pushes one frame when Paso adelante is clicked', async () => {
    render(<CallStack recipe="factorial" arg={3} />);

    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);

    const frames = screen.getAllByTestId('callstack-frame');
    expect(frames).toHaveLength(1);
    expect(frames[0]!).toHaveTextContent('factorial(3)');
  });

  it('grows the stack to full depth then unwinds through subsequent steps', async () => {
    // factorial(2) trace: push(2), push(1), push(0), pop(1), pop(1), pop(2) = 6 events
    render(<CallStack recipe="factorial" arg={2} />);

    const forward = screen.getByRole('button', { name: /paso adelante/i });

    // Push all three frames.
    await userEvent.click(forward);
    await userEvent.click(forward);
    await userEvent.click(forward);
    expect(screen.getAllByTestId('callstack-frame')).toHaveLength(3);

    // First pop: leaves 2 frames + a return value bubbled onto the caller.
    await userEvent.click(forward);
    expect(screen.getAllByTestId('callstack-frame')).toHaveLength(2);
  });

  it('resets the stack to empty when Reset is clicked', async () => {
    render(<CallStack recipe="factorial" arg={3} />);

    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    await userEvent.click(forward);
    expect(screen.getAllByTestId('callstack-frame')).toHaveLength(2);

    const reset = screen.getByRole('button', { name: /reset/i });
    await userEvent.click(reset);
    expect(screen.queryAllByTestId('callstack-frame')).toHaveLength(0);
  });

  it('steps backward, restoring the previous state', async () => {
    render(<CallStack recipe="factorial" arg={3} />);

    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    await userEvent.click(forward);
    expect(screen.getAllByTestId('callstack-frame')).toHaveLength(2);

    const back = screen.getByRole('button', { name: /paso atrás/i });
    await userEvent.click(back);
    expect(screen.getAllByTestId('callstack-frame')).toHaveLength(1);
  });

  it('triggers StackOverflowError when the broken recipe hits the default cap', async () => {
    render(<CallStack recipe="broken" arg={3} />);

    // Advance past the default broken cap (8 frames) to force the overflow.
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    for (let i = 0; i < 10; i++) {
      // Some clicks won't advance past the trace end but we defensively click.
      await userEvent.click(forward);
    }

    expect(screen.getAllByText(/StackOverflowError/i).length).toBeGreaterThan(0);
  });

  it('triggers StackOverflowError on a normal recipe when maxDepth is set low', async () => {
    render(<CallStack recipe="factorial" arg={20} maxDepth={4} />);

    // Force enough steps to reach maxDepth+1.
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    for (let i = 0; i < 10; i++) {
      await userEvent.click(forward);
    }

    expect(screen.getAllByText(/StackOverflowError/i).length).toBeGreaterThan(0);
  });

  it('renders fib(3) as a non-linear trace with the correct final return', async () => {
    // fib(3) events: push(3), push(2), push(1), pop(1), push(0), pop(0), pop(1),
    //                push(1), pop(1), pop(2)   → total 10 events, final return = 2
    render(<CallStack recipe="fib" arg={3} />);

    const forward = screen.getByRole('button', { name: /paso adelante/i });
    for (let i = 0; i < 12; i++) {
      await userEvent.click(forward);
    }

    // At the end, no frames are alive.
    expect(screen.queryAllByTestId('callstack-frame')).toHaveLength(0);
    // The final return is 2 (fib(3) = 2). Scope the assertion to the
    // "último retorno" panel so it does not collide with the step counter
    // or with argument labels elsewhere on the page.
    const returnPanel = screen.getByText(/último retorno/i).closest('div')!;
    expect(returnPanel).toHaveTextContent('2');
  });

  it('labels hanoi frames with the four arguments', async () => {
    render(<CallStack recipe="hanoi" arg={1} />);

    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);

    const frames = screen.getAllByTestId('callstack-frame');
    expect(frames[0]!).toHaveTextContent(/hanoi\(1, A, C, B\)/);
  });

  it('shows the "call stack" chip in the widget header', () => {
    render(<CallStack recipe="factorial" arg={3} />);
    expect(screen.getByText(/call stack/i)).toBeInTheDocument();
  });

  it('disables Paso atrás at step 0 and Paso adelante at the end', async () => {
    render(<CallStack recipe="factorial" arg={1} />);

    const back = screen.getByRole('button', { name: /paso atrás/i });
    const forward = screen.getByRole('button', { name: /paso adelante/i });

    expect(back).toBeDisabled();

    // Click forward until we exhaust the trace.
    for (let i = 0; i < 10; i++) {
      if (!(forward as HTMLButtonElement).disabled) {
        await userEvent.click(forward);
      }
    }

    expect(forward).toBeDisabled();
  });
});
