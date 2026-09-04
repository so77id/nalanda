import type { CatalogEntry } from '../../lib/catalogEntry';

import { DivideCombineTree } from './DivideCombineTree';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const divideCombineTreeCatalogEntry: CatalogEntry = {
  name: 'DivideCombineTree',
  family: 'interactive',
  description:
    'A recursion-tree widget where every chip has two rows (top: the call arguments, bottom: the return value) and an optional middle row (author-provided pivot, in-flight annotation, or per-recipe intermediates). The tree shape carries the pedagogy — `max` renders a wide binary tree (leaves dominate, Θ(N)); `binary-search` renders a linear chain (logarithmic depth, Θ(log N)); `mergesort` and `quicksort` render the divide/combine tree that ADR-0064 wires under `<SortStepper>`. Static drawing, opens fully.',
  whenToUse:
    'For the divide and conquer class, when the reader has just seen an algorithm and needs to see WHAT DIVIDES AND WHAT COMBINES on a concrete input. ' +
    'Five recipes today: `max`, `max-subarray`, `binary-search`, `mergesort`, `quicksort`. Adding a recipe is a code change. ' +
    'Static — no playback, no click-to-expand. The whole tree is visible at once so the reader can compare the shapes at a glance. ' +
    'The `highlightNode` and `nodeAnnotations` props exist so `<SortStepper>` can point at the call it is currently executing and inject a per-chip in-flight annotation; on its own the widget renders every chip in its rest state.',
  props: [
    {
      name: 'recipe',
      type: '"max" | "max-subarray" | "binary-search" | "mergesort" | "quicksort"',
      description: 'Which divide and conquer recipe to draw. Adding one is a code change.',
    },
    {
      name: 'values',
      type: 'number[]',
      description:
        'The input array. Any int array for `max`, `max-subarray`, `mergesort`, `quicksort`. For `binary-search`, must be strictly increasing.',
    },
    {
      name: 'target',
      type: 'number',
      description: 'Required for `binary-search`: the value being searched.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Header override. Defaults to a per-recipe Spanish heading.',
    },
    {
      name: 'highlightNode',
      type: 'string',
      description:
        'When set, the chip whose `call` matches this string is rendered with a focus ring and exposes `data-highlighted="true"`. Used by `<SortStepper>` to point at the currently-executing call.',
    },
    {
      name: 'nodeAnnotations',
      type: 'Record<string, string>',
      description:
        "Optional per-chip middle-row overrides, keyed by the chip's `call`. Used to inject in-flight state — for mergesort the partial merge buffer, for quicksort the partition zones during a stepper frame — without changing the widget's static shape.",
    },
  ],
  examples: [
    {
      title: 'max over 8 elements — binary tree, leaves dominate',
      code: `<DivideCombineTree recipe="max" values={[3, 7, 1, 5, 2, 8, 4, 6]} />`,
      render: () => <DivideCombineTree recipe="max" values={[3, 7, 1, 5, 2, 8, 4, 6]} />,
    },
    {
      title: 'binary-search — linear chain along the path taken',
      code: `<DivideCombineTree recipe="binary-search" values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />`,
      render: () => (
        <DivideCombineTree
          recipe="binary-search"
          values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]}
          target={22}
        />
      ),
    },
    {
      title: 'mergesort — divide by mid, combine by merge',
      code: `<DivideCombineTree recipe="mergesort" values={[3, 7, 1, 5, 2, 8, 4, 6]} />`,
      render: () => <DivideCombineTree recipe="mergesort" values={[3, 7, 1, 5, 2, 8, 4, 6]} />,
    },
    {
      title: 'quicksort — divide by pivot (first element), combine trivially',
      code: `<DivideCombineTree recipe="quicksort" values={[3, 7, 1, 5, 2, 8, 4, 6]} />`,
      render: () => <DivideCombineTree recipe="quicksort" values={[3, 7, 1, 5, 2, 8, 4, 6]} />,
    },
    {
      title: 'mergesort with a stepper frame — highlighted call + in-flight annotation',
      code: `<DivideCombineTree
  recipe="mergesort"
  values={[3, 7, 1, 5]}
  highlightNode="mergesort([3,7,1,5])"
  nodeAnnotations={{ 'mergesort([3,7,1,5])': 'combinando [3,7]+[1,5]' }}
/>`,
      render: () => (
        <DivideCombineTree
          recipe="mergesort"
          values={[3, 7, 1, 5]}
          highlightNode="mergesort([3,7,1,5])"
          nodeAnnotations={{ 'mergesort([3,7,1,5])': 'combinando [3,7]+[1,5]' }}
        />
      ),
    },
  ],
};
