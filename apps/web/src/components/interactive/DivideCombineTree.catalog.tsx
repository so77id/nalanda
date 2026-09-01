import type { CatalogEntry } from '../../lib/catalogEntry';

import { DivideCombineTree } from './DivideCombineTree';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const divideCombineTreeCatalogEntry: CatalogEntry = {
  name: 'DivideCombineTree',
  family: 'interactive',
  description:
    'A recursion-tree widget where every chip has two rows: the call arguments (top, what was divided into this call) and the return value (bottom, what this call combines back up). The tree shape carries the pedagogy — the `max` recipe renders a wide binary tree with one leaf per element (leaves dominate, Θ(N)); the `binary-search` recipe renders a linear chain of the path taken (logarithmic depth, Θ(log N)). Static drawing, opens fully.',
  whenToUse:
    'For the divide and conquer class, when the reader has just seen an algorithm and needs to see WHAT DIVIDES AND WHAT COMBINES on a concrete input. ' +
    'Two recipes today: `max` (binary tree over any int array) and `binary-search` (linear chain along the path taken; requires a sorted array and a target). Adding a recipe is a code change. ' +
    'Static — no playback, no click-to-expand. The whole tree is visible at once so the reader can compare the shapes at a glance. ' +
    'For `max`, keep arrays around 4-8 elements — the tree stays inside the 100-node cap and reads well in a slide. `binary-search` chains scale with log(N), so up to ~16 elements is comfortable.',
  props: [
    {
      name: 'recipe',
      type: '"max" | "binary-search"',
      description: 'Which divide and conquer recipe to draw. Adding one is a code change.',
    },
    {
      name: 'values',
      type: 'number[]',
      description:
        'The input array. Any int array for `max`. For `binary-search`, must be strictly increasing.',
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
  ],
};
