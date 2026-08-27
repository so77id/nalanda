import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyHanoiPlayground as HanoiPlayground } from './lazyHanoiPlayground';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const hanoiPlaygroundCatalogEntry: CatalogEntry = {
  name: 'HanoiPlayground',
  family: 'interactive',
  description:
    'An animated Torres de Hanoi visualizer (ADR-0050). Three vertical pegs, colored discs with size numbers, and a side panel listing the recursive call chain currently executing. Playback is manual by default; controls Play / Pause / Step forward / Step back / Reset drive the walk.',
  whenToUse:
    'When the class introduces or teaches Torres de Hanoi as a canonical recursive problem. Use it to show the algorithm executing move by move alongside the recursive call chain that produced each move. ' +
    'NOT for showing the recursion TREE — that is `<RecursionTree recipe="hanoi">`. ' +
    'NOT for teaching the call stack in general — that is `<CallStack>`.',
  props: [
    {
      name: 'arg',
      type: 'number',
      description: 'Number of discs. Integer between 1 and 6 inclusive. Default 4 (15 moves).',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional heading shown in the header alongside the "torres de hanoi" chip.',
    },
    {
      name: 'autoplay',
      type: 'boolean',
      description:
        'If true, playback starts immediately. Default false: paused at step 0 so the reader (or the professor in class) drives the walk manually.',
    },
    {
      name: 'speed',
      type: 'number',
      description:
        'Playback speed multiplier (0.5, 1, 2). Default 1. Ignored when autoplay is not active.',
    },
    {
      name: 'showRecursiveCall',
      type: 'boolean',
      description:
        'If false, the side panel with the active recursive call chain is hidden and only the tower animation remains. Default true.',
    },
  ],
  examples: [
    {
      title: 'hanoi(4) — the pedagogical default (15 moves)',
      code: '<HanoiPlayground arg={4} />',
      render: () => <HanoiPlayground arg={4} />,
    },
    {
      title: 'hanoi(3) — small enough to walk manually on a slide',
      code: '<HanoiPlayground arg={3} title="hanoi(3)" />',
      render: () => <HanoiPlayground arg={3} title="hanoi(3)" />,
    },
    {
      title: 'hanoi(6) — 63 moves, the maximum the widget accepts',
      code: '<HanoiPlayground arg={6} />',
      render: () => <HanoiPlayground arg={6} />,
    },
    {
      title: 'Sin panel lateral — only the tower animation',
      code: '<HanoiPlayground arg={4} showRecursiveCall={false} />',
      render: () => <HanoiPlayground arg={4} showRecursiveCall={false} />,
    },
    {
      title: 'Invalid arg (too big): the error is for the author',
      code: '<HanoiPlayground arg={10} />',
      render: () => <HanoiPlayground arg={10} />,
    },
  ],
};
