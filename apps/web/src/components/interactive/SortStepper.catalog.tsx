import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazySortStepper } from './lazySortStepper';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in
 * catalogEntries.ts. ADR-0065. */
export const sortStepperCatalogEntry: CatalogEntry = {
  name: 'SortStepper',
  family: 'interactive',
  description:
    'The axis widget of the "Ordenamiento" class. Renders the algorithm code on top (`<CodeStepper>` with the current line highlighted), the array as vertical bars with per-frame status overlays, controls at the foot, and — for the divide/conquer algorithms — the `<DivideCombineTree>` (ADR-0064 hooks) synchronized alongside so the reader sees WHERE in the recursion tree the current frame is executing.',
  whenToUse:
    'For any slide that walks the reader through a sorting algorithm step by step. Five algorithms today: `bubble`, `selection`, `insertion` (n²) and `merge`, `quick` (n log n). Recipes `merge` and `quick` embed `<DivideCombineTree>` internally and pass `highlightNode` + `nodeAnnotations` as the algorithm advances so the tree chip that matches the current call is marked. ' +
    'Autoplay off by default (rule Peli 1/2). ' +
    'Arrays of 6-10 elements read best; 12 is the hard cap.',
  props: [
    {
      name: 'algorithm',
      type: '"bubble" | "selection" | "insertion" | "merge" | "quick"',
      description: 'Which sorting algorithm to trace.',
    },
    {
      name: 'values',
      type: 'number[]',
      description: 'The input array (6-10 elements read best; hard cap at 12).',
    },
    {
      name: 'autoplay',
      type: 'boolean',
      description: 'Playback default. Off by default (rule Peli 1/2).',
    },
    {
      name: 'speed',
      type: '"slow" | "normal" | "fast"',
      description: 'Playback speed. `slow` ≈ 1200ms/step, `normal` ≈ 700ms, `fast` ≈ 300ms.',
    },
    {
      name: 'showCode',
      type: 'boolean',
      description: 'Show the code panel on top of the bars. Default true.',
    },
    {
      name: 'showTree',
      type: 'boolean',
      description:
        'For `merge` and `quick`: show the divide/combine tree beside the bars. Default true. Ignored for the n² algorithms.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Header override. Defaults to a per-algorithm Spanish heading.',
    },
  ],
  examples: [
    {
      title: 'insertion sort — sorted prefix + card metaphor',
      code: `<SortStepper algorithm="insertion" values={[6, 3, 8, 2, 7, 5, 4, 1]} />`,
      render: () => <LazySortStepper algorithm="insertion" values={[6, 3, 8, 2, 7, 5, 4, 1]} />,
    },
    {
      title: 'bubble sort — sorted suffix grows',
      code: `<SortStepper algorithm="bubble" values={[6, 3, 8, 2, 7, 5, 4, 1]} />`,
      render: () => <LazySortStepper algorithm="bubble" values={[6, 3, 8, 2, 7, 5, 4, 1]} />,
    },
    {
      title: 'mergesort — bars + divide/combine tree synchronized',
      code: `<SortStepper algorithm="merge" values={[3, 7, 1, 5]} />`,
      render: () => <LazySortStepper algorithm="merge" values={[3, 7, 1, 5]} />,
    },
    {
      title: 'quicksort — pivot in a distinct color, partition zones tracked',
      code: `<SortStepper algorithm="quick" values={[3, 7, 1, 5]} />`,
      render: () => <LazySortStepper algorithm="quick" values={[3, 7, 1, 5]} />,
    },
  ],
};
