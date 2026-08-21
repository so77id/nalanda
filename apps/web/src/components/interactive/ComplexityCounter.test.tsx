import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ComplexityCounter } from './ComplexityCounter';

// The syntax-highlighted code column splits each line into multiple <span>s,
// so `getByText('int s = 0;', { selector: 'code' })` doesn't match. This
// custom matcher looks for the <code> whose full textContent equals the
// expected line — matches whether the rail's <code> or a rendered code span.
function codeMatching(expected: string) {
  return (_content: string, element: Element | null) =>
    element?.tagName === 'CODE' && element.textContent === expected;
}

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

describe('ComplexityCounter', () => {
  it('shows an authoring error when `data` is missing in base mode', () => {
    render(<ComplexityCounter code="int x = 0;" />);
    // The AuthoringError text is split across text nodes (contains a <code>
    // tag for `data`); match on the leading phrase.
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.getByText('data')).toBeInTheDocument();
  });

  it('shows an authoring error when `code` is missing', () => {
    render(<ComplexityCounter data={SUMA_CICLO_DATA} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  it('shows an authoring error when `cases` is empty in cases mode', () => {
    render(<ComplexityCounter code="int x = 0;" mode="cases" cases={{}} />);
    expect(screen.getByText(/requiere la prop/i)).toBeInTheDocument();
  });

  it('renders one rail row per annotated line, ordered by line number', () => {
    render(
      <ComplexityCounter
        algorithm="sumaCiclo"
        code={SUMA_CICLO_CODE}
        data={SUMA_CICLO_DATA}
        slider={{ default: 10 }}
      />,
    );

    const rail = screen.getByRole('list', { name: /desglose de operaciones/i });
    // Line 2, 3, 4, 5 have annotations — line 1 and 6 do not, so they
    // are absent from the rail.
    expect(within(rail).getByText(codeMatching('int s = 0;'))).toBeInTheDocument();
    expect(
      within(rail).getByText(codeMatching('for (int i = 1; i <= n; i++)')),
    ).toBeInTheDocument();
    expect(within(rail).getByText(codeMatching('s = s + i;'))).toBeInTheDocument();
    expect(within(rail).getByText(codeMatching('return s;'))).toBeInTheDocument();
  });

  it('collapses for-headers by default and shows the aggregated OE total', () => {
    render(
      <ComplexityCounter code={SUMA_CICLO_CODE} data={SUMA_CICLO_DATA} slider={{ default: 10 }} />,
    );

    // The for row's `sub-parts` (init/cond/inc) are NOT visible until expanded.
    expect(screen.queryByText(/^init$/i)).not.toBeInTheDocument();

    // The for row shows the aggregate total instead.
    // For n=10: init(1×1) + cond(1×11) + inc(1×10) = 22 OE.
    const forItem = screen.getByText(codeMatching('for (int i = 1; i <= n; i++)')).closest('li')!;
    expect(forItem).toHaveTextContent(/22/);
    expect(forItem).toHaveTextContent(/control/i);
  });

  it('expands a for-header when the chevron is clicked, revealing sub-ops', async () => {
    render(
      <ComplexityCounter code={SUMA_CICLO_CODE} data={SUMA_CICLO_DATA} slider={{ default: 10 }} />,
    );

    const toggle = screen.getByRole('button', { name: /expandir sub-conteos/i });
    await userEvent.click(toggle);

    // Now the three sub-ops are visible with their labels.
    expect(screen.getByText(/^init$/i)).toBeInTheDocument();
    expect(screen.getByText(/^cond$/i)).toBeInTheDocument();
    expect(screen.getByText(/^inc$/i)).toBeInTheDocument();
  });

  it('shows each plain row with OE, formula, evaluated value, and total contribution', () => {
    render(
      <ComplexityCounter code={SUMA_CICLO_CODE} data={SUMA_CICLO_DATA} slider={{ default: 10 }} />,
    );

    // Line 4: `s = s + i;` → 2 OE · n (=10) → aporta 20 OE.
    const row = screen.getByText(codeMatching('s = s + i;')).closest('li')!;
    expect(row).toHaveTextContent(/2\s*OE/);
    expect(row).toHaveTextContent(/n\s*=\s*10/);
    expect(row).toHaveTextContent(/aporta\s*20/i);
  });

  it('updates the executions and contributions when the slider moves', () => {
    render(
      <ComplexityCounter
        code={SUMA_CICLO_CODE}
        data={SUMA_CICLO_DATA}
        slider={{ min: 1, max: 100, default: 10 }}
      />,
    );

    const row10 = screen.getByText(codeMatching('s = s + i;')).closest('li')!;
    expect(row10).toHaveTextContent(/aporta\s*20/i);

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '20' } });

    const row20 = screen.getByText(codeMatching('s = s + i;')).closest('li')!;
    expect(row20).toHaveTextContent(/aporta\s*40/i);
  });

  it('prints the closed-form T(n) and its evaluation at the current slider', () => {
    render(<ComplexityCounter code={SUMA_CICLO_CODE} data={SUMA_CICLO_DATA} slider={{ default: 10 }} />);

    const heading = screen.getByRole('heading', { level: 4, name: /T\(n\)/i });
    const panel = heading.closest('section')!;
    expect(panel).toHaveTextContent(/4n \+ 4/);
    expect(panel).toHaveTextContent(/T = 44/);
  });

  it('renders three tabs in cases mode and switches the rail on click', async () => {
    render(
      <ComplexityCounter
        code={SUMA_CICLO_CODE}
        mode="cases"
        cases={{
          best: {
            annotations: { 2: { oe: 3, times: '1' } },
            formula: '3',
            evaluate: () => 3,
          },
          worst: SUMA_CICLO_DATA,
        }}
        slider={{ default: 10 }}
      />,
    );

    // Default is 'peor'. Its rail carries `s = s + i;`.
    expect(screen.getByText(codeMatching('s = s + i;'))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^mejor$/i }));
    // 'mejor' has only line 2 annotated, so the for-row is absent from the rail.
    expect(
      screen.queryByText(codeMatching('for (int i = 1; i <= n; i++)')),
    ).not.toBeInTheDocument();
  });

  it('labels the unit column "celdas" and the total M in space mode', () => {
    render(
      <ComplexityCounter
        code={'int[] arr = new int[n];'}
        mode="space"
        data={{
          annotations: { 1: { oe: 1, times: 'n' } },
          formula: 'n',
          evaluate: (n) => n,
        }}
        slider={{ default: 10 }}
      />,
    );

    expect(screen.getAllByText(/celdas/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 4, name: /M\(n\)/i })).toBeInTheDocument();
  });
});
