import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyFibIterSteps as FibIterSteps } from './lazyFibIterSteps';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const fibIterStepsCatalogEntry: CatalogEntry = {
  name: 'FibIterSteps',
  family: 'interactive',
  description:
    'Step-by-step visualization of the memory-collapsed bottom-up Fibonacci — the sliding-window variant with only two live variables. Sits on top of the `<StepShow>` primitive. Each step shows the three variables (`previous`, `current`, `next`) as cells with the same read/write highlight vocabulary as the other fib step widgets: reads in flag, writes in accent. No stack, no array.',
  whenToUse:
    'When the class teaches the memory-collapsed version of bottom-up Fibonacci and needs to see the two-variable sliding window in motion. Complements `<FibTabSteps>` by showing the same Θ(N) result with Θ(1) memory. ' +
    'NOT for showing the full table version — for that, use `<FibTabSteps>`.',
  props: [
    {
      name: 'target',
      type: 'number',
      description:
        'Target n for the iterative fib. Non-negative integer; small values (3–8) work best pedagogically. Default 5.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional title shown above the panels by `<StepShow>`.',
    },
  ],
  examples: [
    {
      title: 'fib(5) — the reference example (walks the two-variable window)',
      code: '<FibIterSteps target={5} />',
      render: () => <FibIterSteps target={5} />,
    },
    {
      title: 'fib(8) — a longer trace, the window slides more times',
      code: '<FibIterSteps target={8} />',
      render: () => <FibIterSteps target={8} />,
    },
  ],
};
