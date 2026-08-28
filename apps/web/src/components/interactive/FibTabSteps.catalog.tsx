import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyFibTabSteps as FibTabSteps } from './lazyFibTabSteps';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const fibTabStepsCatalogEntry: CatalogEntry = {
  name: 'FibTabSteps',
  family: 'interactive',
  description:
    'Step-by-step visualization of bottom-up tabulated Fibonacci. Sits on top of the `<StepShow>` primitive: given a target n, walks a linear trace — initialize `f[0]` and `f[1]`, then walk the `for` from `i = 2` to `n` filling each cell from its two predecessors. Each step highlights the current write cell in accent and the two read cells in flag. No stack (the loop lives in a single frame), no `done` (the `for` index carries the invariant).',
  whenToUse:
    'When the class teaches tabulation (bottom-up dynamic programming) on Fibonacci and needs to see the table being filled left to right. Complements `<FibMemoSteps>` by showing the same $\\Theta(N)$ result computed without recursion. ' +
    'NOT for other tabulated recurrences today — the widget is dedicated to Fibonacci. ' +
    'NOT for showing the memoized top-down version — for that, use `<FibMemoSteps>`.',
  props: [
    {
      name: 'target',
      type: 'number',
      description:
        'Target n for the tabulated fib. Non-negative integer; small values (3–8) work best pedagogically — the trace is linear, so it stays legible up to ~10. Default 5.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional title shown above the panels by `<StepShow>`.',
    },
  ],
  examples: [
    {
      title: 'fib(5) — the reference example (7 steps)',
      code: '<FibTabSteps target={5} />',
      render: () => <FibTabSteps target={5} />,
    },
    {
      title: 'fib(3) — the smallest case that walks the for at least once',
      code: '<FibTabSteps target={3} />',
      render: () => <FibTabSteps target={3} />,
    },
    {
      title: 'fib(8) — a longer trace, the loop reads the two previous cells each step',
      code: '<FibTabSteps target={8} />',
      render: () => <FibTabSteps target={8} />,
    },
  ],
};
