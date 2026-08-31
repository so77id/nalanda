import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyMaxSubarrayViz } from './lazyMaxSubarrayViz';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const maxSubarrayVizCatalogEntry: CatalogEntry = {
  name: 'MaxSubarrayViz',
  family: 'interactive',
  description:
    'The divide and conquer max-subarray visualiser (ADR-0060). Code panel on top with the active line highlighted; array below with the current call frame in focus and the two halves distinctly coloured; the cross-scan cursor visible as it sweeps out from mid; a breadcrumb of the call path so recursion depth is legible; a narration panel that describes each step and shows the running accumulators (leftBest, rightBest, crossMax); controls at the foot. Traces the FULL recursion — the reader sees every enter / return / cross-scan / winner in order.',
  whenToUse:
    'For the max-subarray section of the divide and conquer class, where the reader needs to see how the O(n) cross-scan gives the O(n log n) closed form. The recursion is traced in full; keep the input array small (up to ~8 elements) so the trace stays around 70 steps or fewer. ' +
    'The `<RecursionTreeDivide recipe="max-subarray">` widget lives beside this one for the cost analysis; both are meant to be shown together — this widget is "what the algorithm does on real data", the tree is "why the cost is O(n log n)". ' +
    'Kadane (the O(n) iterative alternative) is deliberately out of scope: this widget is about D&C.',
  props: [
    {
      name: 'values',
      type: 'number[]',
      description:
        'The array to solve. Must contain integers (any sign). Keep it small (≤ ~8 elements) to keep the trace legible.',
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
      title: 'the wikipedia example — answer is the sub-array with sum 6',
      code: `<MaxSubarrayViz values={[-2, 1, -3, 4, -1, 2, 1, -5]} />`,
      render: () => <LazyMaxSubarrayViz values={[-2, 1, -3, 4, -1, 2, 1, -5]} />,
    },
    {
      title: 'four-element array — the cross wins',
      code: `<MaxSubarrayViz values={[1, 2, -1, 3]} />`,
      render: () => <LazyMaxSubarrayViz values={[1, 2, -1, 3]} />,
    },
  ],
};
