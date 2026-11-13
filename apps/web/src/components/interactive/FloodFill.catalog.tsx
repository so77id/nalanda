import type { CatalogEntry } from '../../lib/catalogEntry';

import { FloodFill } from './FloodFill';

const HOUSE = [
  '..........',
  '....##....',
  '...#..#...',
  '..#....#..',
  '.########.',
  '.#......#.',
  '.#.##...#.',
  '.#.##.#.#.',
  '##########',
];

const FOREST = ['..........', '...##.....', '...##.....', '..........', '.....##...', '..........'];

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const floodFillCatalogEntry: CatalogEntry = {
  name: 'FloodFill',
  family: 'interactive',
  description:
    'The paint bucket of a drawing program, spreading by layers. The reader touches a white pixel of an image and the paint advances one layer per tick — up, down, left and right, never across a line — each layer in a colour of its own and every pixel showing its layer: a breadth-first search seen from outside, the pixel’s number being its distance from the touch. With `mode="fire"` the reader picks several foci first and «Encender» lights them together, every pixel taking the steps from the nearest one (several sources in the queue from the start). The layers come from a pure function the suite pins; the hues are spread from red to violet over however many layers the touch produces, so none repeats (the component-scoped palette of `design-system.md`, colour never the only signal).',
  whenToUse:
    'For the moment a class shows what a breadth-first search does to a picture: the region filling as a wave, layer after layer, from where it was touched (#357, arc II). ' +
    'NOT for walking the code line by line — `<GraphWalk>` does that, over a grid too. This shows only the outcome, one layer at a time, and lets the reader choose where to start.',
  props: [
    {
      name: 'grid',
      type: 'string[]',
      description:
        'The image, row by row, all rows of one length: `.` a white pixel, `#` a line. Anything else is an authoring error.',
    },
    {
      name: 'mode',
      type: "'paint' | 'fire'",
      description:
        '`paint` (default): a touch starts the paint at once, and another touch starts over there. `fire`: touches pick the foci, «Encender» lights them all.',
    },
    {
      name: 'label',
      type: 'string',
      description: 'What the image shows, for a screen reader. In Spanish.',
    },
    { name: 'caption', type: 'string', description: 'One line under the image. Optional.' },
    {
      name: 'foci',
      type: '[number, number][]',
      description:
        'With `mode="fire"`: the foci a problem gives, as [row, column], placed from the start. The reader may still add or remove one before «Encender», and «Reiniciar» puts these back.',
    },
    {
      name: 'upTo',
      type: 'number',
      description:
        'A still frame: the given foci lit and the layers up to this one painted, the newest outlined; no touch, no buttons, no status. For a step of a `<StepShow>` that lights the code beside it.',
    },
    {
      name: 'tick',
      type: 'number',
      description: 'Milliseconds per layer. Default 500.',
    },
  ],
  examples: [
    {
      title: 'The paint bucket on a house: touch a room, the sky or the roof',
      code: `<FloodFill
  grid={['..........', '....##....', '...#..#...', '..#....#..', '.########.',
         '.#......#.', '.#.##...#.', '.#.##.#.#.', '##########']}
  label="Una casa dibujada en líneas negras: el techo, una pieza con una ventana y una puerta."
/>`,
      render: () => (
        <FloodFill
          grid={HOUSE}
          label="Una casa dibujada en líneas negras: el techo, una pieza con una ventana y una puerta."
        />
      ),
    },
    {
      title: 'A fire with several foci: pick them, then light them together',
      code: `<FloodFill
  mode="fire"
  grid={['..........', '...##.....', '...##.....', '..........', '.....##...', '..........']}
  foci={[[0, 0], [5, 9]]}
  label="Un bosque con dos rocas que no se queman."
/>`,
      render: () => (
        <FloodFill
          mode="fire"
          grid={FOREST}
          foci={[
            [0, 0],
            [5, 9],
          ]}
          label="Un bosque con dos rocas que no se queman."
        />
      ),
    },
  ],
};
