import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyComplexityExercise as ComplexityExercise } from './lazyComplexityExercise';

const SUMA_CICLO_CODE = `int sumaCiclo(int n) {
    int s = 0;
    for (int i = 1; i <= n; i++)
        s = s + i;
    return s;
}
`;

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const complexityExerciseCatalogEntry: CatalogEntry = {
  name: 'ComplexityExercise',
  family: 'interactive',
  description:
    'A complexity-analysis exercise. Shows a code listing, invites the student to compute T(n) / O() / M(n), and reveals the full development inside a <ComplexityCounter> when the student clicks "Ver desarrollo". Same shape as the Java exercises of the earlier session: code + prompt + button; the difference is that "check" is visual comparison against the annotated counter, not automated correctness (there is no ground truth against a symbolic derivation).',
  whenToUse:
    'One widget = one question, per the agreed rule for the complexity course. When a same code has several angles worth asking (mejor / peor / promedio), author one widget per angle. Reserve `<ComplexityCounter>` (without the wrapper) for the lesson body — the widget explains WHY 4n+4; the exercise asks IF the student sees 4n+4.',
  props: [
    {
      name: 'code',
      type: 'string',
      description:
        'Required. The full source listing shown to the student. Same prop as `<ComplexityCounter>` — it is forwarded verbatim when the counter is revealed.',
    },
    {
      name: 'prompt',
      type: '"T(n)" | "O()" | "M(n)" | string',
      description:
        'The question posed. The three canned values render as full Spanish sentences ("Calcula T(n) en OE y clasifica en Θ." etc). Any other string is treated as a custom prompt and shown verbatim.',
    },
    {
      name: 'hint',
      type: 'string',
      description:
        'Optional preamble shown between the enunciado and the code (short context sentence, e.g. "Asume n par para simplificar").',
    },
    {
      name: 'algorithm',
      type: 'string',
      description:
        'Optional human-readable identifier shown in the header. Forwarded to the revealed `<ComplexityCounter>`.',
    },
    {
      name: 'data / mode / cases / slider / variable / language',
      type: 'same as ComplexityCounter',
      description:
        'All the counter props are accepted and forwarded to the revealed `<ComplexityCounter>`.',
    },
  ],
  examples: [
    {
      title: 'A basic exercise — asks for T(n), reveals the full derivation',
      code: '<ComplexityExercise code="..." prompt="T(n)" data={{ annotations: {...}, formula: "4n + 4", evaluate: n => 4*n + 4 }} />',
      render: () => (
        <ComplexityExercise
          algorithm="sumaCiclo"
          code={SUMA_CICLO_CODE}
          prompt="T(n)"
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
      title: 'Missing code — the error is for the author',
      code: '<ComplexityExercise />',
      render: () => <ComplexityExercise />,
    },
  ],
};
