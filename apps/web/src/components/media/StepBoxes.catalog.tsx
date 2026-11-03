import type { CatalogEntry } from '../../lib/catalogEntry';

import { StepBoxes } from './StepBoxes';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const stepBoxesCatalogEntry: CatalogEntry = {
  name: 'StepBoxes',
  family: 'media',
  description:
    'A chain of values, each in a box with a title over it, and the step that takes one value to the next written over the arrow between them — a key, the number its type turns it into, the position a table takes from that number.',
  whenToUse:
    'Where a class names the steps of a computation and the values each one gives: the hash function as a single step and as the two a library splits it into, or what one object gets at each step. Titles may write a name between backticks to draw it in the code face; a wider value takes a wider box through boxWidth. ' +
    'Promoted from a figure local to edd-tablas-hash when edd-set-map became the second document to want it (#353, add-a-course-document.md §6e-quater). ' +
    'A missing label, fewer than two boxes, or a number of steps other than one fewer than the boxes renders an authoring error.',
  props: [
    {
      name: 'boxes',
      type: '{ title: string; text: string }[]',
      description:
        'The values, in order, each with the title written over its box. A part of a title between backticks is drawn in the code face. At least two.',
    },
    {
      name: 'steps',
      type: 'string[]',
      description:
        'The step written over the arrow between each pair of boxes, in the code face: one fewer than the boxes.',
    },
    {
      name: 'boxWidth',
      type: 'number',
      default: '120',
      description:
        'Width of every box, for values wider than a short key (a RUT, a ten-digit number).',
    },
    {
      name: 'caption',
      type: 'string',
      description: 'A line under the figure; the canvas widens to hold it.',
    },
    {
      name: 'label',
      type: 'string',
      description: 'What the figure shows, in Spanish: its accessible name. Required.',
    },
  ],
  examples: [
    {
      title: 'A key read in base 256 and taken to seven positions',
      code: `<StepBoxes
  boxes={[{ title: 'clave', text: '«Ana»' }, { title: 'número', text: '4 288 097' }, { title: 'posición', text: '2' }]}
  steps={['base 256', 'mod 7']}
  caption="«Ana», leído en base 256 y llevado a siete posiciones"
  label="Tres cajas: la clave «Ana», su número 4 288 097 y su posición 2, unidas por los pasos base 256 y mod 7."
/>`,
      render: () => (
        <StepBoxes
          boxes={[
            { title: 'clave', text: '«Ana»' },
            { title: 'número', text: '4 288 097' },
            { title: 'posición', text: '2' },
          ]}
          steps={['base 256', 'mod 7']}
          caption="«Ana», leído en base 256 y llevado a siete posiciones"
          label="Tres cajas: la clave «Ana», su número 4 288 097 y su posición 2, unidas por los pasos base 256 y mod 7."
        />
      ),
    },
    {
      title: 'What one object gets, in wider boxes and a title in the code face',
      code: `<StepBoxes
  boxes={[{ title: 'el objeto \`a\`', text: '13.180.992-1' }, { title: 'su número', text: '895 328 852' }, { title: 'su posición', text: '5' }]}
  steps={['hashCode()', 'mod 7']}
  boxWidth={150}
  label="El objeto a, el RUT 13.180.992-1, recibe de hashCode el número 895 328 852, y mod 7 lo lleva a la posición 5."
/>`,
      render: () => (
        <StepBoxes
          boxes={[
            { title: 'el objeto `a`', text: '13.180.992-1' },
            { title: 'su número', text: '895 328 852' },
            { title: 'su posición', text: '5' },
          ]}
          steps={['hashCode()', 'mod 7']}
          boxWidth={150}
          label="El objeto a, el RUT 13.180.992-1, recibe de hashCode el número 895 328 852, y mod 7 lo lleva a la posición 5."
        />
      ),
    },
  ],
};
