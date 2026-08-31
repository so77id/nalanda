import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyBinarySearchOnArray } from './lazyBinarySearchOnArray';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const binarySearchOnArrayCatalogEntry: CatalogEntry = {
  name: 'BinarySearchOnArray',
  family: 'interactive',
  description:
    "The classical binary-search trace on a sorted array (ADR-0059). Code panel on top with the active line highlighted; array below with the current `lo`, `mid`, and `hi` markers over the cells and a narration panel that reads the step's decision aloud. On completion the panel emphasises the STEP COUNT — found and not-found take the same number of comparisons, a deliberate pedagogical point of the D&C deck.",
  whenToUse:
    'For the binary-search example in the divide and conquer class, and for any lesson that walks a reader through the algorithm on a specific array. ' +
    "The `<RecursionTreeDivide recipe='binary-search'>` widget lives beside this one for the cost analysis; both are meant to be shown together — this widget is 'what the algorithm does on real data', the tree is 'why the cost is O(log n)'. " +
    'The array must be strictly increasing (the widget rejects a repeat or a descent as an authoring error, with the offending pair called out). ' +
    'Auto-play does not loop; the widget stops on the last step so the outcome panel is what the reader sees.',
  props: [
    {
      name: 'values',
      type: 'number[]',
      description:
        'The sorted array to search over. Must be strictly increasing (a repeat or a descent is refused). Any length; 10 to 16 items reads well in the deck.',
    },
    {
      name: 'target',
      type: 'number',
      description:
        'The integer to search for. May or may not appear in `values` — both cases carry the same pedagogical point (same number of comparisons in the found and not-found paths).',
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
      title: 'target present — the classical successful trace',
      code: `<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />`,
      render: () => (
        <LazyBinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={22} />
      ),
    },
    {
      title: 'target absent — same number of steps as the found case',
      code: `<BinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={20} />`,
      render: () => (
        <LazyBinarySearchOnArray values={[3, 7, 11, 14, 19, 22, 28, 31, 42, 55]} target={20} />
      ),
    },
  ],
};
