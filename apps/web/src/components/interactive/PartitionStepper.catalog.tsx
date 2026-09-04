import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyPartitionStepper as PartitionStepper } from './lazyPartitionStepper';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const partitionStepperCatalogEntry: CatalogEntry = {
  name: 'PartitionStepper',
  family: 'interactive',
  description:
    'Step-by-step visualization of the `partition` OPERATION (Lomuto scheme, pivot = a[0]) — the linear-time routine that reorganises an array around a pivot: everything smaller to the left, everything else to the right. Not quicksort: no recursion, no tree, just one pass with two pointers. Composed on top of the `<StepShow>` primitive. Uses the same shared partition primitive as `<SortStepper algorithm="quick">` so the two widgets agree on behaviour.',
  whenToUse:
    'When the class teaches the partition OPERATION before introducing the recursion of quicksort — the Sedgewick mirror of the mergesort move: understand the linear split first, then the recursion on top gives you N log N on average. NOT for showing full quicksort (that is `<SortStepper algorithm="quick">`).',
  props: [
    {
      name: 'input',
      type: 'number[]',
      description:
        'Array to partition. Pivot is a[0] (Lomuto). Default `[5, 3, 8, 1, 9, 2, 7]` — a balanced split for the reader’s first pass.',
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
      title: 'Partition balanceado (el ejemplo de referencia)',
      code: '<PartitionStepper input={[5, 3, 8, 1, 9, 2, 7]} />',
      render: () => <PartitionStepper input={[5, 3, 8, 1, 9, 2, 7]} />,
    },
    {
      title: 'Peor caso · arreglo ya ordenado → todo se va a la derecha, split degenerado',
      code: '<PartitionStepper input={[1, 2, 3, 4, 5, 6, 7]} />',
      render: () => <PartitionStepper input={[1, 2, 3, 4, 5, 6, 7]} />,
    },
  ],
};
