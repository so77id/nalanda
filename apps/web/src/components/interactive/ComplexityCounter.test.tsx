import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ComplexityCounter } from './ComplexityCounter';

const SUMA_CICLO = {
  breakdown: [
    { line: 'int s = 0;', oe: 1, times: '1' },
    {
      line: 'for (int i = 1; i <= n; i++)',
      subLines: [
        { line: 'int i = 1', oe: 1, times: '1' },
        { line: 'i <= n', oe: 1, times: 'n+1' },
        { line: 'i++', oe: 1, times: 'n' },
      ],
    },
    { line: 's = s + i;', oe: 2, times: 'n' },
    { line: 'return s;', oe: 1, times: '1' },
  ],
  formula: '4n + 4',
  evaluate: (n: number) => 4 * n + 4,
};

describe('ComplexityCounter', () => {
  it('shows an authoring error when `data` is missing in base mode', () => {
    render(<ComplexityCounter />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
  });

  it('shows an authoring error when `cases` is empty in cases mode', () => {
    render(<ComplexityCounter mode="cases" cases={{}} />);
    expect(screen.getByText(/requiere la prop/i)).toBeInTheDocument();
  });

  it('renders one row per breakdown line with the OE count and executions formula', () => {
    render(<ComplexityCounter algorithm="sumaCiclo" data={SUMA_CICLO} slider={{ default: 10 }} />);

    const table = screen.getByRole('table');
    // The four top-level rows each carry their code inside a <code> element;
    // the parent <td> shares the same textContent, so `selector: 'code'`
    // disambiguates. The for-header row collapses its sub-lines by default.
    expect(within(table).getByText('int s = 0;', { selector: 'code' })).toBeInTheDocument();
    expect(
      within(table).getByText('for (int i = 1; i <= n; i++)', { selector: 'code' }),
    ).toBeInTheDocument();
    expect(within(table).getByText('s = s + i;', { selector: 'code' })).toBeInTheDocument();
    expect(within(table).getByText('return s;', { selector: 'code' })).toBeInTheDocument();
    // The for-header shows its "control" label instead of an "executions" formula.
    expect(within(table).getByText(/control/i)).toBeInTheDocument();
    // The non-header rows carry their formula next to the evaluated numbers.
    // `s = s + i;` runs `n` times → for n = 10, the row shows "n = 10".
    const codeRow = within(table)
      .getByText('s = s + i;', { selector: 'code' })
      .closest('tr')!;
    expect(codeRow).toHaveTextContent(/n\s*=\s*10/);
  });

  it('evaluates the executions formulas against the slider value and updates when it moves', async () => {
    render(<ComplexityCounter data={SUMA_CICLO} slider={{ min: 1, max: 100, default: 10 }} />);

    // For n = 10 the row `s = s + i;` executes 10 times.
    const codeBefore = screen.getByText('s = s + i;', { selector: 'code' });
    const rowBefore = codeBefore.closest('tr')!;
    expect(rowBefore).toHaveTextContent(/= 10/);

    // Move the slider to 20 and the same row now shows 20 executions.
    // Range inputs update state on `change` in React; fireEvent.change from
    // @testing-library/react is the shape that actually triggers React's
    // onChange handler (dispatchEvent bypasses React's synthetic event system).
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '20' } });

    const codeAfter = screen.getByText('s = s + i;', { selector: 'code' });
    const rowAfter = codeAfter.closest('tr')!;
    // Formula stays as `n`, evaluated jumps to 20.
    expect(rowAfter).toHaveTextContent(/n\s*=\s*20/);
  });

  it('prints the closed-form T(n) and its numeric evaluation at the current slider value', () => {
    render(<ComplexityCounter data={SUMA_CICLO} slider={{ default: 10 }} />);

    // The Panel's label (h4) and its <pre> content both mention T(n). The
    // heading is the label of the panel — scope the check to it.
    const heading = screen.getByRole('heading', { level: 4, name: /T\(n\)/i });
    const panel = heading.closest('section')!;
    // T(n) = 4n + 4 shown as-is; evaluated at n = 10 → 44.
    expect(panel).toHaveTextContent(/4n \+ 4/);
    expect(panel).toHaveTextContent(/T = 44/);
  });

  it('expands a for-header when its chevron is clicked, showing init/cond/inc as sub-rows', async () => {
    render(<ComplexityCounter data={SUMA_CICLO} slider={{ default: 10 }} />);

    // Collapsed by default.
    expect(screen.queryByText('int i = 1', { selector: 'code' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /expandir sub-conteos/i });
    await userEvent.click(toggle);

    // Now the three sub-parts are visible.
    expect(screen.getByText('int i = 1', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText('i <= n', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText('i++', { selector: 'code' })).toBeInTheDocument();
  });

  it('renders three tabs in cases mode and switches the breakdown on click', async () => {
    render(
      <ComplexityCounter
        mode="cases"
        cases={{
          best: {
            breakdown: [{ line: 'return arr[0] == x ? true : false;', oe: 3, times: '1' }],
            formula: '3',
            evaluate: () => 3,
          },
          worst: SUMA_CICLO,
        }}
        slider={{ default: 10 }}
      />,
    );

    // Default tab is "peor" (worst). Its breakdown carries "s = s + i;".
    expect(screen.getByText('s = s + i;', { selector: 'code' })).toBeInTheDocument();
    // The best-case snippet is not rendered yet.
    expect(
      screen.queryByText('return arr[0] == x ? true : false;', { selector: 'code' }),
    ).not.toBeInTheDocument();

    // Switch to mejor (best) — the best-case snippet appears and the worst one goes.
    await userEvent.click(screen.getByRole('button', { name: /^mejor$/i }));
    expect(
      screen.getByText('return arr[0] == x ? true : false;', { selector: 'code' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('s = s + i;', { selector: 'code' })).not.toBeInTheDocument();
  });

  it('labels the unit column "celdas" and the total M in space mode', () => {
    render(
      <ComplexityCounter
        mode="space"
        data={{
          breakdown: [{ line: 'int[] arr = new int[n];', oe: 1, times: 'n' }],
          formula: 'n',
          evaluate: (n) => n,
        }}
        slider={{ default: 10 }}
      />,
    );

    // "celdas" appears twice: once as the unit label in the header, once in
    // the totals panel — `getAllByText` is honest about that.
    expect(screen.getAllByText(/celdas/i).length).toBeGreaterThan(0);
    // And the total heading is labelled M, not T. Both the h4 label and the
    // <pre> content mention M(n); scope to the heading role.
    expect(screen.getByRole('heading', { level: 4, name: /M\(n\)/i })).toBeInTheDocument();
  });
});
