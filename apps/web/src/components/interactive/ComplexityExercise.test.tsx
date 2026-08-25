import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ComplexityExercise } from './ComplexityExercise';

const SUMA_CICLO_CODE = `int sumaCiclo(int n) {
    int s = 0;
    for (int i = 1; i <= n; i++)
        s = s + i;
    return s;
}`;

const SUMA_CICLO_DATA = {
  annotations: {
    2: { oe: 1, times: '1' },
    3: {
      sub: [
        { label: 'init', oe: 1, times: '1' },
        { label: 'cond', oe: 1, times: 'n+1' },
        { label: 'inc', oe: 1, times: 'n' },
      ],
    },
    4: { oe: 2, times: 'n' },
    5: { oe: 1, times: '1' },
  },
  formula: '4n + 4',
  evaluate: (n: number) => 4 * n + 4,
};

describe('ComplexityExercise', () => {
  it('shows an authoring error when `code` is missing', () => {
    render(<ComplexityExercise data={SUMA_CICLO_DATA} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  it('renders the canned T(n) prompt in Spanish', () => {
    render(<ComplexityExercise code={SUMA_CICLO_CODE} prompt="T(n)" data={SUMA_CICLO_DATA} />);
    expect(screen.getByText(/Calcula T\(n\) en OE y clasifica en Θ/)).toBeInTheDocument();
  });

  it('renders the canned M(n) prompt in Spanish', () => {
    render(
      <ComplexityExercise
        code={SUMA_CICLO_CODE}
        prompt="M(n)"
        mode="space"
        data={{
          annotations: { 2: { oe: 1, times: 'n' } },
          formula: 'n',
          evaluate: (n) => n,
        }}
      />,
    );
    expect(screen.getByText(/Calcula M\(n\) en celdas/)).toBeInTheDocument();
  });

  it('accepts a custom prompt verbatim', () => {
    render(
      <ComplexityExercise
        code={SUMA_CICLO_CODE}
        prompt="¿Cuánto vale T(10)?"
        data={SUMA_CICLO_DATA}
      />,
    );
    expect(screen.getByText(/¿Cuánto vale T\(10\)\?/)).toBeInTheDocument();
  });

  it('renders the hint above the code when provided', () => {
    render(
      <ComplexityExercise
        code={SUMA_CICLO_CODE}
        prompt="T(n)"
        hint="Asume n par para simplificar."
        data={SUMA_CICLO_DATA}
      />,
    );
    expect(screen.getByText(/Asume n par para simplificar\./)).toBeInTheDocument();
  });

  it('mounts a single editor — the same box expands when revealing, not a second widget below', async () => {
    // Before reveal: one editor (the code-only counter). After reveal:
    // still one editor (same instance, now with rail + panel). No
    // duplicate CodeStepper mounts.
    render(<ComplexityExercise code={SUMA_CICLO_CODE} prompt="T(n)" data={SUMA_CICLO_DATA} />);

    // Editor identity check: the CodeStepper renders exactly one wrapper
    // with `data-highlight-lines`. Before and after reveal, this count is 1.
    expect(document.querySelectorAll('[data-highlight-lines]').length).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: /ver desarrollo/i }));

    expect(document.querySelectorAll('[data-highlight-lines]').length).toBe(1);
  });

  it('hides the ComplexityCounter development until the reveal button is pressed', async () => {
    render(<ComplexityExercise code={SUMA_CICLO_CODE} prompt="T(n)" data={SUMA_CICLO_DATA} />);

    // The counter's rail is absent before reveal.
    expect(
      screen.queryByRole('list', { name: /desglose de operaciones/i }),
    ).not.toBeInTheDocument();

    const reveal = screen.getByRole('button', { name: /ver desarrollo/i });
    expect(reveal).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(reveal);

    // Now the counter is mounted and the rail visible.
    const rail = screen.getByRole('list', { name: /desglose de operaciones/i });
    expect(rail).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ocultar desarrollo/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('toggles the reveal back off when the button is pressed again', async () => {
    render(<ComplexityExercise code={SUMA_CICLO_CODE} prompt="T(n)" data={SUMA_CICLO_DATA} />);

    const toggle = screen.getByRole('button', { name: /ver desarrollo/i });
    await userEvent.click(toggle);
    expect(screen.getByRole('list', { name: /desglose de operaciones/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /ocultar desarrollo/i }));
    expect(
      screen.queryByRole('list', { name: /desglose de operaciones/i }),
    ).not.toBeInTheDocument();
  });

  it('gives the student a textarea to type their answer before revealing', async () => {
    render(<ComplexityExercise code={SUMA_CICLO_CODE} prompt="T(n)" data={SUMA_CICLO_DATA} />);

    const textarea = screen.getByRole('textbox', { name: /tu respuesta al ejercicio/i });
    await userEvent.type(textarea, 'T(n) = 4n + 4');
    expect(textarea).toHaveValue('T(n) = 4n + 4');

    // Revealing does not clear the student's typed answer.
    await userEvent.click(screen.getByRole('button', { name: /ver desarrollo/i }));
    expect(textarea).toHaveValue('T(n) = 4n + 4');
  });

  it('forwards the algorithm identifier to the revealed counter', async () => {
    render(
      <ComplexityExercise
        algorithm="sumaCiclo"
        code={SUMA_CICLO_CODE}
        prompt="T(n)"
        data={SUMA_CICLO_DATA}
      />,
    );

    // The exercise header carries it before reveal.
    const exerciseHeader = screen.getByText('sumaCiclo');
    expect(exerciseHeader).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /ver desarrollo/i }));

    // After reveal the same identifier is visible in the counter's own
    // header — two occurrences in total.
    expect(screen.getAllByText('sumaCiclo').length).toBeGreaterThanOrEqual(2);
  });

  it('renders a custom reveal ReactNode instead of the counter when `reveal` is set', async () => {
    render(
      <ComplexityExercise
        code={`// Two abstract algorithms — no annotated code`}
        prompt="¿Cuándo A supera a B?"
        reveal={<p data-testid="custom-reveal">Cuando N &gt; 100 A gana.</p>}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /ver desarrollo/i }));

    expect(screen.getByTestId('custom-reveal')).toBeInTheDocument();
    // The <ComplexityCounter> is NOT mounted when reveal is provided —
    // it has no annotated data to render.
    expect(
      screen.queryByRole('list', { name: /desglose de operaciones/i }),
    ).not.toBeInTheDocument();
  });

  it('supports cases mode and switches tabs on the revealed counter', async () => {
    render(
      <ComplexityExercise
        code={SUMA_CICLO_CODE}
        prompt="T(n)"
        mode="cases"
        cases={{
          best: {
            annotations: { 2: { oe: 3, times: '1' } },
            formula: '3',
            evaluate: () => 3,
          },
          worst: SUMA_CICLO_DATA,
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /ver desarrollo/i }));

    // Default 'peor' case shown; can switch to 'mejor'.
    const mejorTab = screen.getByRole('button', { name: /^mejor$/i });
    await userEvent.click(mejorTab);

    // 'mejor' only annotates line 2 — the `for` row is absent from the rail.
    const rail = screen.getByRole('list', { name: /desglose de operaciones/i });
    expect(within(rail).queryByText(/for \(int i = 1/)).not.toBeInTheDocument();
  });
});
