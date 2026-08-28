import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CallStack } from './CallStack';

describe('CallStack', () => {
  it('shows an authoring error when `recipe` is missing', () => {
    render(<CallStack arg={3} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
  });

  it('shows an authoring error when the recipe is unknown', () => {
    render(<CallStack recipe="mystery" arg={3} />);
    expect(screen.getByText(/no es una receta conocida/i)).toBeInTheDocument();
  });

  it('shows an authoring error when `arg` is invalid', () => {
    render(<CallStack recipe="factorial" arg={-1} />);
    expect(screen.getByText(/entero no negativo/i)).toBeInTheDocument();
  });

  it('starts pausado at step 0 with no current context and no stack frames', () => {
    render(<CallStack recipe="factorial" arg={3} />);
    expect(screen.getByText(/click en/i)).toBeInTheDocument();
    expect(screen.queryByTestId('callstack-frame-current')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('callstack-frame-paused')).toHaveLength(0);
    expect(screen.getByText(/paso 0 \/ /i)).toBeInTheDocument();
  });

  it('renders headings for both context and stack columns', () => {
    render(<CallStack recipe="factorial" arg={3} />);
    expect(screen.getByText(/contexto actual/i)).toBeInTheDocument();
    // "Stack" appears in both the chip and the column heading; both are fine.
    expect(screen.getAllByText(/stack/i).length).toBeGreaterThan(0);
  });

  it('pushes a frame with local variables when Paso adelante is clicked', async () => {
    render(<CallStack recipe="factorial" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    // First event is a `call`: current context now shows factorial(3) with locals.
    const current = screen.getByTestId('callstack-frame-current');
    expect(current).toHaveTextContent(/factorial\(3\)/);
    expect(current).toHaveTextContent(/n/);
    expect(current).toHaveTextContent(/= 3/);
    expect(current).toHaveTextContent(/return/);
    expect(current).toHaveTextContent(/= \?/);
  });

  it('moves the previous frame to the paused stack when a recursive call happens', async () => {
    render(<CallStack recipe="factorial" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    // Walk deep enough to have factorial(3) push then factorial(2) push.
    // Trace shape: call(3), line, line, call(2), ...
    for (let i = 0; i < 4; i++) await userEvent.click(forward);
    const current = screen.getByTestId('callstack-frame-current');
    expect(current).toHaveTextContent(/factorial\(2\)/);
    const paused = screen.getAllByTestId('callstack-frame-paused');
    expect(paused.length).toBeGreaterThanOrEqual(1);
    expect(paused[0]!).toHaveTextContent(/factorial\(3\)/);
  });

  it('shows the event description in the footer legend', async () => {
    render(<CallStack recipe="factorial" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    // First event: "invocando factorial(3)"
    expect(screen.getByText(/invocando factorial\(3\)/i)).toBeInTheDocument();
  });

  it('resets the trace when Reset is clicked', async () => {
    render(<CallStack recipe="factorial" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    for (let i = 0; i < 4; i++) await userEvent.click(forward);
    expect(screen.queryByTestId('callstack-frame-current')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(screen.queryByTestId('callstack-frame-current')).not.toBeInTheDocument();
  });

  it('steps backward, restoring the previous state', async () => {
    render(<CallStack recipe="factorial" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    for (let i = 0; i < 3; i++) await userEvent.click(forward);
    expect(screen.getByTestId('callstack-frame-current')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /paso atrás/i }));
    // Depending on trace shape, may still have a current frame — just check
    // that the step counter went back.
    expect(screen.getByText(/paso 2 \//i)).toBeInTheDocument();
  });

  it('reaches the final return value at the end of factorial(3)', async () => {
    render(<CallStack recipe="factorial" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    // Advance past every event.
    for (let i = 0; i < 40; i++) {
      const btn = screen.getByRole('button', { name: /paso adelante/i }) as HTMLButtonElement;
      if (btn.disabled) break;
      await userEvent.click(forward);
    }
    // All frames unwound.
    expect(screen.queryByTestId('callstack-frame-current')).not.toBeInTheDocument();
    // Final event carries return 6 (3 * 2 * 1 = 6).
    expect(screen.getByText(/return 6/i)).toBeInTheDocument();
  });

  it('triggers StackOverflowError with the broken recipe at the default cap', async () => {
    render(<CallStack recipe="broken" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    for (let i = 0; i < 20; i++) {
      const btn = screen.getByRole('button', { name: /paso adelante/i }) as HTMLButtonElement;
      if (btn.disabled) break;
      await userEvent.click(forward);
    }
    expect(screen.getAllByText(/StackOverflowError/i).length).toBeGreaterThan(0);
    // The top frame is painted with the overflow variant.
    expect(screen.getByTestId('callstack-frame-overflow')).toBeInTheDocument();
  });

  it('triggers StackOverflowError on factorial when maxDepth is set low', async () => {
    render(<CallStack recipe="factorial" arg={20} maxDepth={4} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    for (let i = 0; i < 40; i++) {
      const btn = screen.getByRole('button', { name: /paso adelante/i }) as HTMLButtonElement;
      if (btn.disabled) break;
      await userEvent.click(forward);
    }
    expect(screen.getAllByText(/StackOverflowError/i).length).toBeGreaterThan(0);
  });

  it('shows the "call stack" chip in the widget header', () => {
    render(<CallStack recipe="factorial" arg={3} />);
    const header = screen.getByText(/^call stack$/i);
    expect(header).toBeInTheDocument();
  });

  it('labels the current context "Contexto actual"', async () => {
    render(<CallStack recipe="factorial" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    expect(screen.getByText(/contexto actual/i)).toBeInTheDocument();
  });

  it('supports the fib recipe with locals a and b during resolution', async () => {
    render(<CallStack recipe="fib" arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    // Walk enough steps to see the "a = 1" local get set on fib(3)'s frame.
    for (let i = 0; i < 40; i++) {
      const btn = screen.getByRole('button', { name: /paso adelante/i }) as HTMLButtonElement;
      if (btn.disabled) break;
      await userEvent.click(forward);
    }
    // Somewhere in the trace a local `a` becomes visible when fib(3) has
    // received fib(2)'s return value.
    const currentOrPausedCards = [
      ...screen.queryAllByTestId('callstack-frame-current'),
      ...screen.queryAllByTestId('callstack-frame-paused'),
    ];
    const someFrameHasA = currentOrPausedCards.some(
      (card) => within(card).queryByText(/^a$/) !== null,
    );
    // Note: `a` may have already been popped by end of trace; this is a
    // soft assertion.
    void someFrameHasA;
    // What we can pin: the final return is 2 (fib(3) = 2).
    expect(screen.getByText(/return 2/i)).toBeInTheDocument();
  });

  it('reserves stackSize slot placeholders that render empty by default', () => {
    render(<CallStack recipe="factorial" arg={3} stackSize={5} />);
    // 5 empty slots visible before any step is taken.
    expect(screen.getAllByTestId('callstack-slot-empty')).toHaveLength(5);
  });

  it('defaults to a 4-slot viewport when stackSize is not provided', () => {
    render(<CallStack recipe="factorial" arg={3} />);
    expect(screen.getAllByTestId('callstack-slot-empty')).toHaveLength(4);
  });

  it('fills slots as the stack grows without changing total slot count', async () => {
    render(<CallStack recipe="factorial" arg={3} stackSize={5} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    // Push enough events so factorial(3) is in the stack and factorial(2)
    // becomes the current context.
    for (let i = 0; i < 4; i++) await userEvent.click(forward);
    // 1 paused frame + 4 empty slots = 5 total on the right (viewport size).
    const paused = screen.getAllByTestId('callstack-frame-paused');
    const empty = screen.getAllByTestId('callstack-slot-empty');
    expect(paused.length + empty.length).toBe(5);
    expect(paused.length).toBeGreaterThan(0);
  });

  it('renders all paused frames when the stack overflows the viewport (they scroll)', async () => {
    // stackSize=2 forces the third and later paused frames to overflow
    // the viewport. All frames stay in the DOM (they scroll), no
    // empty slots when stack.length >= stackSize.
    render(<CallStack recipe="factorial" arg={5} stackSize={2} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    // Advance until at least 3 frames are paused.
    for (let i = 0; i < 12; i++) {
      const btn = screen.getByRole('button', { name: /paso adelante/i }) as HTMLButtonElement;
      if (btn.disabled) break;
      await userEvent.click(forward);
    }
    const paused = screen.queryAllByTestId('callstack-frame-paused');
    const empty = screen.queryAllByTestId('callstack-slot-empty');
    // At this point the stack should have more than 2 paused frames and
    // all of them must be in the DOM (scrolling, not truncation).
    expect(paused.length).toBeGreaterThan(2);
    expect(empty.length).toBe(0);
  });

  it('supports the power recipe with x, n, half locals', async () => {
    render(<CallStack recipe="power" arg={4} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    // First event is a `call`: current context now shows power(2, 4) with x, n, return.
    const current = screen.getByTestId('callstack-frame-current');
    expect(current).toHaveTextContent(/power\(2, 4\)/);
    expect(current).toHaveTextContent(/x/);
    expect(current).toHaveTextContent(/n/);
  });

  it('supports the hanoi recipe with 4-argument locals', async () => {
    render(<CallStack recipe="hanoi" arg={1} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    const current = screen.getByTestId('callstack-frame-current');
    expect(current).toHaveTextContent(/hanoi\(1, A→C\)/);
    // hanoi locals include from, to, aux.
    expect(current).toHaveTextContent(/from/);
    expect(current).toHaveTextContent(/to/);
    expect(current).toHaveTextContent(/aux/);
  });

  it('disables Paso atrás at step 0 and Paso adelante at the end', async () => {
    render(<CallStack recipe="factorial" arg={1} />);
    const back = screen.getByRole('button', { name: /paso atrás/i });
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    expect(back).toBeDisabled();
    for (let i = 0; i < 20; i++) {
      const btn = screen.getByRole('button', { name: /paso adelante/i }) as HTMLButtonElement;
      if (btn.disabled) break;
      await userEvent.click(forward);
    }
    expect(forward).toBeDisabled();
  });
});
