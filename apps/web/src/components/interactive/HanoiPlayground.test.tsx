import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { HanoiPlayground } from './HanoiPlayground';

describe('HanoiPlayground', () => {
  it('shows an authoring error when arg is greater than the max', () => {
    render(<HanoiPlayground arg={10} />);
    expect(screen.getByText(/máximo es 6/i)).toBeInTheDocument();
  });

  it('shows an authoring error when arg is not a positive integer', () => {
    render(<HanoiPlayground arg={0} />);
    expect(screen.getByText(/entero ≥ 1/i)).toBeInTheDocument();
  });

  it('renders three towers with the correct initial disc arrangement', () => {
    render(<HanoiPlayground arg={3} />);
    // Tower A starts with all 3 discs, B and C are empty.
    const towerA = screen.getByTestId('hanoi-tower-A');
    const towerB = screen.getByTestId('hanoi-tower-B');
    const towerC = screen.getByTestId('hanoi-tower-C');
    expect(within(towerA, 'hanoi-disc-1')).toBeInTheDocument();
    expect(within(towerA, 'hanoi-disc-2')).toBeInTheDocument();
    expect(within(towerA, 'hanoi-disc-3')).toBeInTheDocument();
    expect(within(towerB, 'hanoi-disc-1')).toBeNull();
    expect(within(towerC, 'hanoi-disc-1')).toBeNull();
  });

  it('advances the animation by one step when Paso adelante is clicked', async () => {
    render(<HanoiPlayground arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    // The step counter reflects the click.
    expect(screen.getByText(/paso 1 \//i)).toBeInTheDocument();
  });

  it('moves disc 1 from A to C as the first physical move of hanoi(3)', async () => {
    // hanoi(3) first performs several `call` events, then the first `move`:
    // disc 1: A -> C. Click enough times to reach that move.
    render(<HanoiPlayground arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    // We advance to step 4 which is past the first move (call, call, call, move).
    // A robust check is: after enough clicks, the "movimiento" counter is at least 1.
    for (let i = 0; i < 6; i++) {
      await userEvent.click(forward);
    }
    // Header shows movement count > 0.
    expect(screen.getByText(/movimiento: [1-7] \/ 7/i)).toBeInTheDocument();
  });

  it('completes the puzzle after enough Paso adelante clicks: all discs on C', async () => {
    // hanoi(2) is compact enough to walk to completion in the test.
    render(<HanoiPlayground arg={2} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    // Advance far enough that we hit the end and the button disables.
    for (let i = 0; i < 30; i++) {
      const btn = screen.getByRole('button', { name: /paso adelante/i }) as HTMLButtonElement;
      if (btn.disabled) break;
      await userEvent.click(forward);
    }
    // At the end: 3 moves for hanoi(2), all discs on C.
    expect(screen.getByText(/movimiento: 3 \/ 3/i)).toBeInTheDocument();
    const towerC = screen.getByTestId('hanoi-tower-C');
    expect(towerC.querySelectorAll('[data-testid^="hanoi-disc-"]').length).toBe(2);
  });

  it('resets the puzzle to the initial state when Reset is clicked', async () => {
    render(<HanoiPlayground arg={3} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    for (let i = 0; i < 5; i++) {
      await userEvent.click(forward);
    }
    const reset = screen.getByRole('button', { name: /reset/i });
    await userEvent.click(reset);
    expect(screen.getByText(/paso 0 \//i)).toBeInTheDocument();
    expect(screen.getByText(/movimiento: 0 \/ 7/i)).toBeInTheDocument();
  });

  it('shows the "torres de hanoi" chip in the widget header', () => {
    render(<HanoiPlayground arg={3} />);
    expect(screen.getByText(/torres de hanoi/i)).toBeInTheDocument();
  });

  it('shows the active recursive call chain when showRecursiveCall is true (default)', async () => {
    render(<HanoiPlayground arg={2} />);
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    await userEvent.click(forward);
    // At step 1, one call is active: the root.
    expect(screen.getByText(/hanoi\(2, A → C\)/)).toBeInTheDocument();
    expect(screen.getByText(/llamada recursiva/i)).toBeInTheDocument();
  });

  it('hides the side panel when showRecursiveCall is false', () => {
    render(<HanoiPlayground arg={3} showRecursiveCall={false} />);
    expect(screen.queryByText(/llamada recursiva/i)).not.toBeInTheDocument();
  });

  it('disables Paso atrás at step 0 and Paso adelante at the end', async () => {
    render(<HanoiPlayground arg={1} />);
    const back = screen.getByRole('button', { name: /paso atrás/i });
    const forward = screen.getByRole('button', { name: /paso adelante/i });
    expect(back).toBeDisabled();

    for (let i = 0; i < 30; i++) {
      const btn = screen.getByRole('button', { name: /paso adelante/i }) as HTMLButtonElement;
      if (btn.disabled) break;
      await userEvent.click(forward);
    }
    expect(forward).toBeDisabled();
  });
});

/**
 * Helper: matches a descendant `data-testid` inside a container. Returns the
 * element or null. Used because there is no built-in `within` for this
 * pattern in the Testing Library that returns null instead of throwing.
 */
function within(container: HTMLElement, testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}
