import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyComplexityCounter as ComplexityCounter } from './lazyComplexityCounter';

const SUMA_CICLO_CODE = `int sumaCiclo(int n) {
    int s = 0;
    for (int i = 1; i <= n; i++)
        s = s + i;
    return s;
}
`;

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const complexityCounterCatalogEntry: CatalogEntry = {
  name: 'ComplexityCounter',
  family: 'interactive',
  description:
    'A widget that makes the process of counting operations visible (ADR-0045). The author writes an algorithm plus a declarative breakdown — one row per line, each with its OE count and a formula for how many times the line runs — and the widget renders a three-column table (code, OE per execution, executions), a T(n) sum, and its evaluation under a reader-controlled slider on the variable.',
  whenToUse:
    'Anywhere the class teaches HOW to count operations: from the first for-loop precalentamiento to the full breakdown of the three implementations of suma(N), and again in Act 5 for FindInArray in all three cases (best / worst / average). Mode "space" swaps OE for memory cells and is used for spatial complexity. ' +
    'NOT for showing the RESULT of running the code — that is the Benchmark widget. ' +
    'NOT for teaching recursion analysis — the declarative counting model here does not handle recurrences (a future extension for Peli 2 is filed separately). Keep breakdowns short — six or seven rows is the working budget; longer tables lose the point they are meant to make visible.',
  props: [
    {
      name: 'algorithm',
      type: 'string',
      description: 'Optional human-readable identifier shown in the widget header.',
    },
    {
      name: 'code',
      type: 'string',
      description:
        'Optional full source. If provided, it appears in a "codigo completo" panel below the breakdown for reference. The breakdown table shows one row per line and is usually sufficient on its own.',
    },
    {
      name: 'mode',
      type: '"base" | "cases" | "space"',
      description:
        'Layout mode. "base" (default): one case, shown as a single table + formula. "cases": three tabs (mejor / peor / promedio), each carrying its own breakdown and formula — used for FindInArray in Act 5. "space": same layout as base but the OE column is labelled "celdas de memoria" and the total is M(n) rather than T(n).',
    },
    {
      name: 'data',
      type: '{ breakdown, formula, evaluate }',
      description:
        'For mode "base" or "space": the case to render. `breakdown` is an array of rows (each with `line`, `oe`, `times` — or a `subLines` array for a for-header that collapses its init/cond/inc sub-parts under a chevron). `formula` is the closed form as text (e.g. "4n + 4"). `evaluate` is a JS function `(n) => number` used for the numeric evaluation under the slider — declarative so the widget does not have to parse the formula.',
    },
    {
      name: 'cases',
      type: '{ best?, worst?, average? }',
      description:
        'For mode "cases": each of the three tabs carries its own case with the same shape as `data`.',
    },
    {
      name: 'slider',
      type: '{ min?, max?, default?, step? }',
      description:
        'Range slider config for the variable. Defaults to { min: 1, max: 100, default: 10, step: 1 }. Every field is individually optional.',
    },
    {
      name: 'variable',
      type: 'string',
      description:
        'Variable name shown in the formulas and the slider label. Defaults to "n". Change it when the algorithm speaks a different letter (e.g. "a" and "b" in Euclides would use two counters or a wrapping component).',
    },
  ],
  examples: [
    {
      title: 'The first count of the class: sumaCiclo with the for-header collapsed and expandable',
      code: '<ComplexityCounter algorithm="sumaCiclo" data={{ breakdown: [...], formula: "4n + 4", evaluate: n => 4*n + 4 }} />',
      render: () => (
        <ComplexityCounter
          algorithm="sumaCiclo"
          code={SUMA_CICLO_CODE}
          data={{
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
            evaluate: (n) => 4 * n + 4,
          }}
          slider={{ min: 1, max: 100, default: 10 }}
        />
      ),
    },
    {
      title: 'Cases mode: FindInArray in the three qualitatively distinct cases from Act 5',
      code: '<ComplexityCounter mode="cases" cases={{ best, worst, average }} />',
      render: () => (
        <ComplexityCounter
          algorithm="findInArray"
          mode="cases"
          cases={{
            best: {
              breakdown: [
                { line: 'int i = 0', oe: 1, times: '1' },
                { line: 'i < arr.length', oe: 1, times: '1' },
                { line: 'arr[i] == x', oe: 2, times: '1' },
                { line: 'return true;', oe: 1, times: '1' },
              ],
              formula: '5',
              evaluate: () => 5,
            },
            worst: {
              breakdown: [
                { line: 'int i = 0', oe: 1, times: '1' },
                { line: 'i < arr.length', oe: 1, times: 'n+1' },
                { line: 'i++', oe: 1, times: 'n' },
                { line: 'arr[i] == x', oe: 2, times: 'n' },
                { line: 'return false;', oe: 1, times: '1' },
              ],
              formula: '4n + 3',
              evaluate: (n) => 4 * n + 3,
            },
            average: {
              breakdown: [
                { line: 'int i = 0', oe: 1, times: '1' },
                { line: 'i < arr.length', oe: 1, times: '(n+1)/2' },
                { line: 'i++', oe: 1, times: '(n-1)/2' },
                { line: 'arr[i] == x', oe: 2, times: '(n+1)/2' },
                { line: 'return true;', oe: 1, times: '1' },
              ],
              formula: '2n + 3',
              evaluate: (n) => 2 * n + 3,
            },
          }}
          slider={{ min: 1, max: 100, default: 10 }}
        />
      ),
    },
    {
      title: 'Missing data: the error is for the author, not the student',
      code: '<ComplexityCounter />',
      render: () => <ComplexityCounter />,
    },
  ],
};
