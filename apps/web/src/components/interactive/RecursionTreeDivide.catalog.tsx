import type { CatalogEntry } from '../../lib/catalogEntry';

import { RecursionTreeDivide } from './RecursionTreeDivide';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const recursionTreeDivideCatalogEntry: CatalogEntry = {
  name: 'RecursionTreeDivide',
  family: 'interactive',
  description:
    "The divide and conquer axis widget (ADR-0058). Draws the recursion tree of a D&C algorithm — each chip shows the sub-problem size T(k) and, when the combine cost is non-constant, its work as O(f(k)) inline — and a right-side cost rail showing 'nodos × combine = total' per level with the closed form Θ(...) at the foot. The reader SEES that the total cost is work-per-level × number-of-levels, before the Master Theorem shortcut collapses the cuenta.",
  whenToUse:
    'For any D&C algorithm the deck wants to analyse from first principles — before or alongside the Master Theorem shortcut. ' +
    'Five recipes today: `binary-search` (linear chain, Θ(log n)), `max-array` (Θ(n)), `max-subarray` and `closest-pair` (both Θ(n log n)), `karatsuba` (Θ(n^log_2 3)). Adding one is a code change (RECIPES in the source), by design — MDX props do not carry lambdas well. ' +
    'NOT for a per-algorithm visualization on real data — those are `<BinarySearchOnArray>`, `<MaxSubarrayViz>`, `<ClosestPairViz>`, `<KaratsubaViz>`. This widget draws the tree and the cost only. ' +
    'The tree opens fully (no expand/collapse click-through) — a slide reader gets more from seeing the whole shape at once (same call as `<RecursionTree>` after Miguel review, ADR-0056). ' +
    'The size `n` must be a power of the recipe base (2 for all five recipes); a non-power renders an `<AuthoringError>` explaining why. ' +
    'Capped at 300 nodes: karatsuba(n=32) is 364 and refused; karatsuba(n=16) at 121 fits, and the four binary recipes go comfortably up to n=64.',
  props: [
    {
      name: 'recipe',
      type: '"binary-search" | "max-array" | "max-subarray" | "closest-pair" | "karatsuba"',
      description:
        'Which divide and conquer recipe to draw. Each recipe carries its own recurrence T(n) = a·T(n/b) + O(f(n)) and its header. Adding one is a code change.',
    },
    {
      name: 'n',
      type: 'number',
      description:
        'Size of the root problem. Positive integer AND a power of the recipe base (all five recipes use b=2, so a power of 2). The widget rejects non-powers with an authoring error because the pedagogical drawing depends on same-size partitions at every level.',
    },
    {
      name: 'title',
      type: 'string',
      description:
        "Override for the header, shown in the widget's title. Optional; defaults to the recipe's default header, e.g. `Karatsuba: T(n) = 3T(n/2) + O(n)`.",
    },
  ],
  examples: [
    {
      title: 'max-subarray (n=8) — the reference case, Θ(n log n)',
      code: `<RecursionTreeDivide recipe="max-subarray" n={8} />`,
      render: () => <RecursionTreeDivide recipe="max-subarray" n={8} />,
    },
    {
      title: 'binary-search (n=8) — the linear chain, Θ(log n)',
      code: `<RecursionTreeDivide recipe="binary-search" n={8} />`,
      render: () => <RecursionTreeDivide recipe="binary-search" n={8} />,
    },
    {
      title: 'karatsuba (n=8) — the ternary tree, Θ(n^log_2 3)',
      code: `<RecursionTreeDivide recipe="karatsuba" n={8} />`,
      render: () => <RecursionTreeDivide recipe="karatsuba" n={8} />,
    },
  ],
};
