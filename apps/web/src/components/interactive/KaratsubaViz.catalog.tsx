import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyKaratsubaViz } from './lazyKaratsubaViz';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const karatsubaVizCatalogEntry: CatalogEntry = {
  name: 'KaratsubaViz',
  family: 'interactive',
  description:
    'The Karatsuba multiplication visualiser (ADR-0062). Code panel on top; algebraic reveal panel below that grows one row at a time — split, naive expansion (4 products), pivot to Karatsuba, the three products P1 / P2 / P3, the algebraic middle = P3 - P1 - P2 = ad + bc, reconstruction, final answer. The pedagogical target of the widget is the algebraic trick that turns 4 sub-multiplications into 3.',
  whenToUse:
    'For the Karatsuba section that closes the divide and conquer class — the historical anecdote (Kolmogorov 1960, Karatsuba refuting the O(n^2) conjecture in a week) is planted in Block 1 of the deck and harvested with this widget in Block 4. ' +
    'The recursion is NOT visualised here: the three subproducts (P1, P2, P3) are shown as concrete values. The abstract recurrence T(n) = 3T(n/2) + O(n) is stated as prose beside this widget in the deck (per ADR-0063 Karatsuba does not get a companion recursion-tree widget). ' +
    'x and y can be any positive integers. The classical pedagogical example is 1234 × 5678 = 7006652 with clean splits at m=2.',
  props: [
    {
      name: 'x',
      type: 'number',
      description: 'The first factor. Positive integer. Ideal range: 2 to 6 digits.',
    },
    {
      name: 'y',
      type: 'number',
      description: 'The second factor. Positive integer. Ideal range: 2 to 6 digits.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Header override. Defaults to the standard Spanish heading for this widget.',
    },
    {
      name: 'speed',
      type: 'number',
      description: 'Playback multiplier: 0.5 · 1 · 2. Defaults to 1.',
    },
    {
      name: 'autoplay',
      type: 'boolean',
      description: 'Start playing on mount. Single pass — does not loop.',
    },
  ],
  examples: [
    {
      title: 'the classical example — 1234 × 5678 = 7006652 with the algebraic trick visible',
      code: `<KaratsubaViz x={1234} y={5678} />`,
      render: () => <LazyKaratsubaViz x={1234} y={5678} />,
    },
    {
      title: 'six-digit factors — the trick still holds at bigger scale',
      code: `<KaratsubaViz x={314159} y={271828} />`,
      render: () => <LazyKaratsubaViz x={314159} y={271828} />,
    },
  ],
};
