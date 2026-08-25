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
    'A widget that makes the process of counting operations visible (ADR-0045). Real CodeEditor on the left, side rail on the right. Rail rows are keyed by CODE LINE NUMBER — annotations line up with the source. Hovering a line in the editor highlights its annotation; hovering an annotation highlights its line. For-headers collapse under a chevron and display the aggregated OE total on the header row.',
  whenToUse:
    'Anywhere the class teaches HOW to count operations. Modes: "base" (one case, with slider + formula), "cases" (three tabs for best/worst/average), "space" (memory cells instead of OE; total labelled M(n)), "abstract" (code + per-line annotations without slider or derivation — used to introduce the code before any specific case has been derived, or per individual case with `skipped` lines dimmed). ' +
    'NOT for showing the RESULT of running code — that is the Benchmark widget. ' +
    'NOT for recursion analysis — the declarative model here does not handle recurrences.',
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
        'Required. The full source code shown on the left. Annotations are anchored to this code by 1-based line number.',
    },
    {
      name: 'mode',
      type: '"base" | "cases" | "space" | "abstract"',
      description:
        'Layout mode. "base" (default): one case with slider + closed-form derivation. "cases": three tabs (best / worst / average), each carrying its own case. "space": base layout but the unit column is memory cells and the total is M(n). "abstract": code + per-line annotations only — no slider, no formula, no derivation panel; `times` is displayed as descriptive text (e.g. "per iteration") rather than an algebraic expression. In "abstract" mode `skipped` on the case dims listed code lines and renders a dedicated "does not execute" rail row for each. Added at ADR-0045 amendment 2026-08-25.',
    },
    {
      name: 'data',
      type: '{ annotations, formula?, evaluate?, skipped? }',
      description:
        'For modes "base", "space", "abstract" (the single case). `annotations`: `{ [lineNumber]: { oe, times } }` or `{ [lineNumber]: { sub: [{label, oe, times}, ...] } }` for for-headers. `formula`: closed form as text (e.g. "4n + 4"); REQUIRED for "base"/"space", ignored in "abstract". `evaluate`: JS function `(n) => number` for the numeric evaluation under the slider; REQUIRED for "base"/"space", ignored in "abstract". `skipped`: optional `Array<{ line: number; note?: string }>` naming lines that don\'t execute in this case — the widget dims them in the editor and lists the notes in the rail (used with "abstract" per-case).',
    },
    {
      name: 'cases',
      type: '{ best?, worst?, average? }',
      description: 'For mode "cases": each tab carries its own case with the same shape as `data`.',
    },
    {
      name: 'slider',
      type: '{ min?, max?, default?, step? }',
      description:
        'Range slider config for the variable. Defaults to { min: 1, max: 100, default: 10, step: 1 }. Ignored in "abstract" mode (no slider).',
    },
    {
      name: 'variable',
      type: 'string',
      description: 'Variable name shown in formulas and the slider label. Defaults to "n".',
    },
    {
      name: 'language',
      type: 'string',
      description: 'Language for CodeStepper syntax highlighting. Defaults to "java".',
    },
    {
      name: 'showAnalysis',
      type: 'boolean',
      description:
        'When false, renders only the read-only editor (no header, tabs, slider, rail or panel). Used by `<ComplexityExercise>` to show the code before the student clicks "Ver desarrollo" — the SAME box then expands with the analysis, rather than a second widget mounting below. Default true.',
    },
    {
      name: 'showHeader',
      type: 'boolean',
      description:
        'When false, suppresses the widget\'s own header (the "operaciones · <algorithm>" tag). Used by wrappers like `<ComplexityExercise>` that already draw their own header. Default true.',
    },
  ],
  examples: [
    {
      title: 'sumaCiclo — annotations by line number, for-header collapsed by default',
      code: '<ComplexityCounter code="..." data={{ annotations: { 2: { oe: 1, times: "1" }, 3: { sub: [...] }, 4: { oe: 2, times: "n" }, 5: { oe: 1, times: "1" } }, formula: "4n + 4", evaluate: n => 4*n + 4 }} />',
      render: () => (
        <ComplexityCounter
          algorithm="sumaCiclo"
          code={SUMA_CICLO_CODE}
          data={{
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
            evaluate: (n) => 4 * n + 4,
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
