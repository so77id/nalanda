import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyComplexityCounter as ComplexityCounter } from './lazyComplexityCounter';

const SUMA_CICLO_CODE = `int sumaCiclo(int n) {
    int s = 0;
    for (int i = 1; i <= n; i++)
        s = s + i;
    return s;
}
`;

const FIB_NAIVE_CODE = `long fib(int n) {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
}
`;

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const complexityCounterCatalogEntry: CatalogEntry = {
  name: 'ComplexityCounter',
  family: 'interactive',
  description:
    'A widget that makes the process of counting operations visible (ADR-0045). Real CodeEditor on the left, side rail on the right. Rail rows are keyed by CODE LINE NUMBER — annotations line up with the source. Hovering a line in the editor highlights its annotation; hovering an annotation highlights its line. For-headers collapse under a chevron and display the aggregated OE total on the header row.',
  whenToUse:
    'Anywhere the class teaches HOW to count operations, or HOW to analyse a recursive algorithm. Modes: "base" (one case, with slider + formula), "cases" (three tabs for best/worst/average), "space" (memory cells instead of OE; total labelled M(n)), "abstract" (code + per-line annotations without slider or derivation — used to introduce the code before any specific case has been derived, or per individual case with `skipped` lines dimmed), "recursion" (code + per-line notes + three panels — Recurrencia, Desarrollo, Forma cerrada — for linear-recurrence analyses; ADR-0053). ' +
    'NOT for showing the RESULT of running code — that is the Benchmark widget. ' +
    'NOT for Master-Theorem cases (a*T(n/b) + f(n)) — a future divide and conquer WP will add its own extension.',
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
      type: '"base" | "cases" | "space" | "abstract" | "recursion"',
      description:
        'Layout mode. "base" (default): one case with slider + closed-form derivation. "cases": three tabs (best / worst / average), each carrying its own case. "space": base layout but the unit column is memory cells and the total is M(n). "abstract": code + per-line annotations only — no slider, no formula, no derivation panel; `times` is displayed as descriptive text (e.g. "per iteration") rather than an algebraic expression. In "abstract" mode `skipped` on the case dims listed code lines and renders a dedicated "does not execute" rail row for each. Added at ADR-0045 amendment 2026-08-25. "recursion" (ADR-0053): the widget renders three static panels — Recurrencia (T(n) = … plus base cases), Desarrollo (an ordered list of unroll steps with optional parentheticals) and Forma cerrada (emphasised) — plus per-line `note` annotations in the rail. No slider, no algebraic parsing.',
    },
    {
      name: 'data',
      type: '{ annotations, formula?, evaluate?, skipped?, recurrence?, base?, unroll?, closedForm? }',
      description:
        'For modes "base", "space", "abstract", "recursion" (the single case). `annotations`: `{ [lineNumber]: { oe, times } }` or `{ [lineNumber]: { sub: [{label, oe, times}, ...] } }` for for-headers; in "recursion" mode annotations use `{ note: string }` instead (free-form pedagogical text). `formula`: closed form as text (e.g. "4n + 4"); REQUIRED for "base"/"space", ignored in "abstract"/"recursion". `evaluate`: JS function `(n) => number` for the numeric evaluation under the slider; REQUIRED for "base"/"space", ignored in "abstract"/"recursion". `skipped`: optional `Array<{ line: number; note?: string }>` naming lines that don\'t execute in this case — the widget dims them in the editor and lists the notes in the rail (used with "abstract" per-case). `recurrence`/`base`/`unroll`/`closedForm`: REQUIRED for "recursion" (see the recursion catalog example).',
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
      title: 'fibNaive — recursion mode (ADR-0053): T(n) = T(n-1) + T(n-2) + c ⇒ Θ(φⁿ)',
      code: '<ComplexityCounter mode="recursion" code="..." data={{ annotations: { 2: { note: "..." }, 3: { note: "..." } }, recurrence: "T(n) = T(n-1) + T(n-2) + c", base: { "T(0)": "c", "T(1)": "c" }, unroll: [{form, note}, ...], closedForm: "T(n) = Θ(φⁿ)" }} />',
      render: () => (
        <ComplexityCounter
          algorithm="fibNaive"
          mode="recursion"
          code={FIB_NAIVE_CODE}
          data={{
            annotations: {
              2: { note: 'caso base ⇒ c' },
              3: { note: 'dos llamadas recursivas ⇒ T(n-1) + T(n-2) + c' },
            },
            recurrence: 'T(n) = T(n-1) + T(n-2) + c',
            base: { 'T(0)': 'c', 'T(1)': 'c' },
            unroll: [
              { form: 'T(n) = T(n-1) + T(n-2) + c', note: 'punto de partida' },
              {
                form: 'T(n) = [T(n-2) + T(n-3) + c] + T(n-2) + c',
                note: 'sustituimos T(n-1)',
              },
              {
                form: 'T(n) = 2·T(n-2) + T(n-3) + 2c',
                note: 'agrupamos las dos copias de T(n-2)',
              },
              {
                form: '⋮',
                note: 'el árbol crece: cada nivel casi duplica la cuenta',
              },
              {
                form: 'T(n) ≈ φ · T(n-1) para n grande',
                note: 'la razón entre términos consecutivos de F(n) tiende a φ',
              },
            ],
            closedForm: 'T(n) = Θ(φⁿ)',
          }}
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
