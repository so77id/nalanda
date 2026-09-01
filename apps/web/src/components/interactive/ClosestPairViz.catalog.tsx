import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyClosestPairViz } from './lazyClosestPairViz';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const closestPairVizCatalogEntry: CatalogEntry = {
  name: 'ClosestPairViz',
  family: 'interactive',
  description:
    'The divide and conquer closest-pair visualiser (ADR-0061). Code panel on top with the algorithm and its strip sweep; a 2D SVG plane below with the input points, the vertical dividing line for the current call, the strip of width 2d centred on the median, the current best pair connected by a line, and dashed lines showing pairs being tested during the sweep. Full trace of the recursion — every enter, every brute-force pair, every strip sweep pair, every winner — with the euclidean distance readable to two decimals on every step.',
  whenToUse:
    'For the closest-pair section of the divide and conquer class. This is the widget that makes the strip-of-width-d trick visible: the reader sees the O(n) sweep that gives the algorithm its O(n log n) closed form, and sees why the answer can cross the dividing line (a case the pure two-halves approach would miss). ' +
    'Closest-pair does NOT get a companion recursion-tree widget in the deck (per ADR-0063 §Deck simplification); the recurrence T(n) = 2T(n/2) + O(n) is stated as prose beside the widget. ' +
    'Point sets of up to ~8 points fit within the 300-step trace cap. Points can be given in any order; the widget sorts them internally by x (indices in the trace refer to the sorted order).',
  props: [
    {
      name: 'points',
      type: 'Array<{x: number, y: number}>',
      description:
        'The point set. At least 2 points. Any order (the widget sorts by x internally). Coordinates can be any real numbers; the plane auto-scales.',
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
      title: 'eight points — the pedagogical example (the closest pair crosses the mid)',
      code: `<ClosestPairViz points={[
  {x:1,y:3},{x:2,y:8},{x:4,y:2},{x:5,y:6},
  {x:6,y:4},{x:8,y:1},{x:9,y:7},{x:10,y:5}
]} />`,
      render: () => (
        <LazyClosestPairViz
          points={[
            { x: 1, y: 3 },
            { x: 2, y: 8 },
            { x: 4, y: 2 },
            { x: 5, y: 6 },
            { x: 6, y: 4 },
            { x: 8, y: 1 },
            { x: 9, y: 7 },
            { x: 10, y: 5 },
          ]}
        />
      ),
    },
    {
      title: 'four points — one recursion level',
      code: `<ClosestPairViz points={[
  {x:1,y:1},{x:2,y:4},{x:6,y:1},{x:7,y:4}
]} />`,
      render: () => (
        <LazyClosestPairViz
          points={[
            { x: 1, y: 1 },
            { x: 2, y: 4 },
            { x: 6, y: 1 },
            { x: 7, y: 4 },
          ]}
        />
      ),
    },
  ],
};
