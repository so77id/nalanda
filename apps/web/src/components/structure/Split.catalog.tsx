import type { CatalogEntry } from '../../lib/catalogEntry';

import { Figure } from '../media/Figure';
import { Split } from './Split';

const COST_CURVE = 'asset:courses/sample-course/costo-busqueda.svg';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const splitCatalogEntry: CatalogEntry = {
  name: 'Split',
  family: 'structure',
  description:
    'Two blocks side by side, stacked on a narrow screen, with an optional uneven ratio. Draws nothing of its own: no border, no label, no type scaling.',
  whenToUse:
    'When a figure belongs BESIDE the text it illustrates rather than under it — the commonest slide in a class that explains a picture. It holds any two blocks: prose, a figure, a fence, a component. ' +
    'Not to be confused with <SideBySide>, which is the code comparator: its border, its language chip and its 0.72em are measured for a <pre> (ADR-0022, #76), and a picture dropped into one renders inside something that looks like a listing. The difference is behaviour, not decoration — SideBySide declares itself a frame, so an editor inside it drops its own chrome; a Split declares nothing, so everything inside renders exactly as it would alone. ' +
    'The two are duplicated layout on purpose for now; the ADR records when to revisit merging them.',
  props: [
    {
      name: 'ratio',
      type: "'50/50' | '60/40' | '40/60'",
      default: "'50/50'",
      description:
        'How the width divides from the md breakpoint up. The uneven options exist so a figure need not take half the slide from the text it illustrates.',
    },
    {
      name: 'children',
      type: 'MDX',
      description:
        'Exactly two blocks; authored order is kept, so the first is the left column. Any other number renders an authoring error, because with three the pairing is ambiguous and guessing would silently drop one.',
    },
  ],
  examples: [
    {
      title: 'A figure beside the text it explains',
      code: `<Split ratio="60/40">

- La búsqueda lineal compara hasta n veces.
- La binaria descarta la mitad en cada paso.

<Figure src="./costo-busqueda.svg" alt="Dos curvas de costo comparadas" />

</Split>`,
      render: () => (
        <Split ratio="60/40">
          <ul>
            <li>La búsqueda lineal compara hasta n veces.</li>
            <li>La binaria descarta la mitad en cada paso.</li>
          </ul>
          <Figure src={COST_CURVE} alt="Dos curvas de costo comparadas" />
        </Split>
      ),
    },
    {
      title: 'Given any number of blocks that is not two',
      code: `<Split>

Un solo bloque.

</Split>`,
      render: () => (
        <Split>
          <p>Un solo bloque.</p>
        </Split>
      ),
    },
  ],
};
