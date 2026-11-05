import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyPenTrace as PenTrace } from './lazyPenTrace';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const penTraceCatalogEntry: CatalogEntry = {
  name: 'PenTrace',
  family: 'interactive',
  description:
    'A figure to trace without lifting the pen. The reader presses a point to put the pen down, then, one after another, the points to draw the strokes to; a drawn stroke turns keep and thick, the rest stays dashed. It refuses a jump to a point no free stroke reaches and a stroke drawn twice, and a live status line says how many strokes are left, when the tracing is stuck (in flag) and when it is done (in keep) — and whether it ended where it began. The starting point keeps a ring; Deshacer and Empezar de nuevo undo. With `solvable`, a Resolver button draws one way to trace the figure, stroke by stroke from its starting point, or says in the status line that there is none, without saying why.',
  whenToUse:
    'When a slide asks the reader to TRY a drawing before the rule that decides it: the house, the envelope, the star, Königsberg (grafos-representacion, #356). The rule itself — the degrees, the odd vertices — is a static <NodeGraph> with notes; PenTrace is the experiment, not the explanation. ' +
    '`figure` draws the points as small unlabelled dots with strokes meeting at their centres, so the figure looks like the drawing; without it, the points are lettered vertices on <NodeGraph>’s geometry, for a graph such as Königsberg, whose parallel strokes bend apart. ' +
    'Place a vertex at every point where strokes meet or cross, as the class teaches. Loaded on demand like <HanoiPlayground>, its precedent. Two runtime contracts: a missing `label` and a stroke that names an undrawn point each render an authoring error.',
  props: [
    {
      name: 'nodes',
      type: '{ v, x, y }[]',
      description:
        'The points: a label (read aloud as «Punto A»), a column x and a row y, from 0. Any fraction places a point between grid lines, as a star’s corners need.',
    },
    {
      name: 'edges',
      type: '[from, to][]',
      description: 'The strokes, by their two points. The same pair twice is two strokes.',
    },
    { name: 'cols', type: 'number', description: 'How many columns the grid has.' },
    { name: 'rows', type: 'number', description: 'How many rows the grid has.' },
    {
      name: 'figure',
      type: 'boolean',
      default: 'false',
      description:
        'Unlabelled dots and strokes meeting at their centres: the figure as drawn. Off, the points are lettered vertices.',
    },
    {
      name: 'solvable',
      type: 'boolean',
      default: 'false',
      description:
        'A Resolver button: it draws one solution stroke by stroke (Hierholzer’s walk from the first odd point, or the first point when none is odd), or says the figure cannot be traced from any point. The why stays out: that is Euler’s rule, which the class teaches after the game.',
    },
    {
      name: 'label',
      type: 'string',
      description: 'What the figure is, in Spanish: its accessible name. Required.',
    },
  ],
  examples: [
    {
      title: 'The house: it can be traced, from one bottom corner to the other',
      code: `<PenTrace
  figure
  solvable
  cols={3}
  rows={4}
  nodes={[{ v: 'A', x: 1, y: 0 }, { v: 'B', x: 0, y: 1 }, { v: 'C', x: 2, y: 1 }, { v: 'F', x: 1, y: 2 }, { v: 'D', x: 0, y: 3 }, { v: 'E', x: 2, y: 3 }]}
  edges={[['A', 'B'], ['A', 'C'], ['B', 'C'], ['B', 'D'], ['C', 'E'], ['D', 'E'], ['B', 'F'], ['F', 'E'], ['C', 'F'], ['F', 'D']]}
  label="La casa: un cuadrado con sus dos diagonales y un techo, para trazar sin levantar el lápiz."
/>`,
      render: () => (
        <PenTrace
          figure
          solvable
          cols={3}
          rows={4}
          nodes={[
            { v: 'A', x: 1, y: 0 },
            { v: 'B', x: 0, y: 1 },
            { v: 'C', x: 2, y: 1 },
            { v: 'F', x: 1, y: 2 },
            { v: 'D', x: 0, y: 3 },
            { v: 'E', x: 2, y: 3 },
          ]}
          edges={[
            ['A', 'B'],
            ['A', 'C'],
            ['B', 'C'],
            ['B', 'D'],
            ['C', 'E'],
            ['D', 'E'],
            ['B', 'F'],
            ['F', 'E'],
            ['C', 'F'],
            ['F', 'D'],
          ]}
          label="La casa: un cuadrado con sus dos diagonales y un techo, para trazar sin levantar el lápiz."
        />
      ),
    },
    {
      title: 'The envelope: it cannot be traced',
      code: `<PenTrace
  figure
  solvable
  cols={3}
  rows={3}
  nodes={[{ v: 'A', x: 0, y: 0 }, { v: 'B', x: 2, y: 0 }, { v: 'E', x: 1, y: 1 }, { v: 'C', x: 0, y: 2 }, { v: 'D', x: 2, y: 2 }]}
  edges={[['A', 'B'], ['C', 'D'], ['A', 'C'], ['B', 'D'], ['A', 'E'], ['E', 'D'], ['B', 'E'], ['E', 'C']]}
  label="El sobre: un rectángulo con sus dos diagonales, para trazar sin levantar el lápiz."
/>`,
      render: () => (
        <PenTrace
          figure
          solvable
          cols={3}
          rows={3}
          nodes={[
            { v: 'A', x: 0, y: 0 },
            { v: 'B', x: 2, y: 0 },
            { v: 'E', x: 1, y: 1 },
            { v: 'C', x: 0, y: 2 },
            { v: 'D', x: 2, y: 2 },
          ]}
          edges={[
            ['A', 'B'],
            ['C', 'D'],
            ['A', 'C'],
            ['B', 'D'],
            ['A', 'E'],
            ['E', 'D'],
            ['B', 'E'],
            ['E', 'C'],
          ]}
          label="El sobre: un rectángulo con sus dos diagonales, para trazar sin levantar el lápiz."
        />
      ),
    },
    {
      title: 'Königsberg: lettered vertices and parallel strokes',
      code: `<PenTrace
  cols={3}
  rows={3}
  nodes={[{ v: 'B', x: 1, y: 0 }, { v: 'A', x: 0, y: 1 }, { v: 'D', x: 2, y: 1 }, { v: 'C', x: 1, y: 2 }]}
  edges={[['A', 'B'], ['A', 'B'], ['A', 'C'], ['A', 'C'], ['A', 'D'], ['B', 'D'], ['C', 'D']]}
  label="Königsberg: cuatro orillas y siete puentes, para cruzarlos todos una sola vez."
/>`,
      render: () => (
        <PenTrace
          cols={3}
          rows={3}
          nodes={[
            { v: 'B', x: 1, y: 0 },
            { v: 'A', x: 0, y: 1 },
            { v: 'D', x: 2, y: 1 },
            { v: 'C', x: 1, y: 2 },
          ]}
          edges={[
            ['A', 'B'],
            ['A', 'B'],
            ['A', 'C'],
            ['A', 'C'],
            ['A', 'D'],
            ['B', 'D'],
            ['C', 'D'],
          ]}
          label="Königsberg: cuatro orillas y siete puentes, para cruzarlos todos una sola vez."
        />
      ),
    },
  ],
};
