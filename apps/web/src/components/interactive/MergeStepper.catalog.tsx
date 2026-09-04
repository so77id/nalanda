import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyMergeStepper as MergeStepper } from './lazyMergeStepper';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const mergeStepperCatalogEntry: CatalogEntry = {
  name: 'MergeStepper',
  family: 'interactive',
  description:
    'Step-by-step visualization of the `merge` OPERATION — the linear-time combine that takes two already-sorted arrays and produces one sorted array. Not mergesort: no recursion, no tree, just two pointers walking two inputs and writing one output. Composed on top of the `<StepShow>` primitive.',
  whenToUse:
    'When the class teaches the merge OPERATION before introducing the recursion of mergesort — the Cormen move: understand the linear combine first, then the recurrence on top gives you N log N. NOT for showing full mergesort (that is `<SortStepper algorithm="merge">`).',
  props: [
    {
      name: 'left',
      type: 'number[]',
      description:
        'Left input array. MUST be sorted ascending — the operation assumes it. Default `[1, 4, 6]`.',
    },
    {
      name: 'right',
      type: 'number[]',
      description: 'Right input array. MUST be sorted ascending. Default `[2, 3, 5, 7]`.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional title shown above the panels by `<StepShow>`.',
    },
    {
      name: 'autoplay',
      type: 'boolean',
      description: 'Autoplay on mount. Off by default (rule Peli 1/2).',
    },
    {
      name: 'speed',
      type: '"slow" | "normal" | "fast"',
      description: 'Playback speed. Default `normal`.',
    },
  ],
  examples: [
    {
      title: 'Merging two sorted arrays (the reference example)',
      code: '<MergeStepper left={[1, 4, 6]} right={[2, 3, 5, 7]} />',
      render: () => <MergeStepper left={[1, 4, 6]} right={[2, 3, 5, 7]} />,
    },
    {
      title: 'One side runs out much earlier (explicit drain of the rest)',
      code: '<MergeStepper left={[2, 3, 9, 10]} right={[1]} />',
      render: () => <MergeStepper left={[2, 3, 9, 10]} right={[1]} />,
    },
  ],
};
