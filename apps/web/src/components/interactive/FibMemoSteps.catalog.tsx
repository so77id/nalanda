import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyFibMemoSteps as FibMemoSteps } from './lazyFibMemoSteps';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const fibMemoStepsCatalogEntry: CatalogEntry = {
  name: 'FibMemoSteps',
  family: 'interactive',
  description:
    'Step-by-step visualization of top-down memoized Fibonacci. Sits on top of the `<StepShow>` primitive: given a target n, walks a real DFS execution of `fib(n)` with memoization and renders each transition as a step showing the current call stack, the `memo[]` and `done[]` arrays, and a Spanish caption. Cache hits are highlighted in the accent color when they land, so the reader sees exactly where the recursion would have re-descended.',
  whenToUse:
    "When the class teaches memoization on Fibonacci and needs to see the cache filling and being read. Complements the plain `<CallStack recipe='fib' />` widget by showing what changes when we add `memo[]` and `done[]`. " +
    'NOT for other memoized recursions today — the widget is dedicated to Fibonacci; other recurrences would need their own dedicated step widget. ' +
    'NOT for teaching the naive recursion — for that, use `<CallStack recipe="fib" />` and `<RecursionTree recipe="fib" />`.',
  props: [
    {
      name: 'target',
      type: 'number',
      description:
        'Target n for `fib(n)`. Non-negative integer; small values (2–7) work best pedagogically — the trace grows fast even with the cache. Default 5.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional title shown above the panels by `<StepShow>`.',
    },
  ],
  examples: [
    {
      title: 'fib(5) — the reference example (walks 22 steps, two cache hits)',
      code: '<FibMemoSteps target={5} />',
      render: () => <FibMemoSteps target={5} />,
    },
    {
      title: 'fib(3) — the smallest case that still shows a cache hit',
      code: '<FibMemoSteps target={3} />',
      render: () => <FibMemoSteps target={3} />,
    },
    {
      title: 'fib(6) — a longer trace with more cache hits',
      code: '<FibMemoSteps target={6} />',
      render: () => <FibMemoSteps target={6} />,
    },
  ],
};
