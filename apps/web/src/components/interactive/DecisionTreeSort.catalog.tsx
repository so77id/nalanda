import type { CatalogEntry } from '../../lib/catalogEntry';

import { DecisionTreeSort } from './DecisionTreeSort';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in
 * catalogEntries.ts. ADR-0066. */
export const decisionTreeSortCatalogEntry: CatalogEntry = {
  name: 'DecisionTreeSort',
  family: 'interactive',
  description:
    'Visualises the log₂(N!) lower bound for comparison-based sorting: each internal node compares two positions of the input, each leaf is a possible sorted output. Renders the balanced tree — the one that splits permutations 50/50 at every node — so its height equals ⌈log₂(N!)⌉, matching the bound the class argues. Static tree with a "Mostrar peor caso" toggle that highlights the deepest path.',
  whenToUse:
    'For the section of the "Ordenamiento" class that argues the N log N lower bound. Recipes by size: `n=2` (2 leaves, height 1), `n=3` (6 leaves, height 3), `n=4` (24 leaves, height 5). Beyond n=4 the tree becomes too dense to read on a slide. ' +
    'The data panel on the side names N!, the tree height, and the ⌈log₂(N!)⌉ bound — connecting the pedagogy directly to Stirling.',
  props: [
    {
      name: 'n',
      type: '2 | 3 | 4',
      description: 'Number of elements to sort. The tree has N! leaves and height ⌈log₂(N!)⌉.',
    },
    {
      name: 'showBound',
      type: 'boolean',
      description: 'Show the data panel with N!, height and the ⌈log₂(N!)⌉ bound. Default true.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Header override. Defaults to a per-n Spanish heading.',
    },
  ],
  examples: [
    {
      title: 'n=3 — 6 leaves, height 3 (matches ⌈log₂(6)⌉)',
      code: `<DecisionTreeSort n={3} />`,
      render: () => <DecisionTreeSort n={3} />,
    },
    {
      title: 'n=4 — 24 leaves, height 5 (matches ⌈log₂(24)⌉)',
      code: `<DecisionTreeSort n={4} />`,
      render: () => <DecisionTreeSort n={4} />,
    },
    {
      title: 'n=2 — just one comparison decides everything',
      code: `<DecisionTreeSort n={2} />`,
      render: () => <DecisionTreeSort n={2} />,
    },
  ],
};
