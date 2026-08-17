import type { CatalogEntry } from '../../lib/catalogEntry';

import { Figure } from '../media/Figure';
import { Mosaic } from './Mosaic';
import { ModeProvider } from '../../presentation';

const COST_CURVE = 'asset:courses/sample-course/costo-busqueda.svg';
const GROUP = 'Cuatro veces la misma curva de costo, a modo de ejemplo';

function cells(count: number) {
  return Array.from({ length: count }, (_, i) => <Figure key={i} src={COST_CURVE} alt="" />);
}

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const mosaicCatalogEntry: CatalogEntry = {
  name: 'Mosaic',
  family: 'structure',
  description:
    'Several blocks in a grid — 2, 3 or 4 per row — carrying a single accessible description for the whole group, with silent cells.',
  whenToUse:
    'When the picture is the SET and not any of its members: a wall of company logos, of languages, of competition badges. ' +
    'That shape is why this is a component and not a CSS class. The container speaks once — a screen reader announces "empresas que usan estructuras de datos a diario" instead of nine brand names in a row — and <Figure> accepts an empty alt only inside one of these, so the rule stays absolute and its single exception lives where the description already is. A missing alt is still an error even here: silence must be something the author wrote. ' +
    'The column count is never inferred from the child count, because six figures are 3x2 or 2x3 depending on what the author meant.',
  props: [
    {
      name: 'columns',
      type: '2 | 3 | 4',
      description:
        'Cells per row. Required. On a slide the grid holds at that count (ADR-0013 scales a slide whole); in the book it drops to two columns below the md breakpoint, where nine logos across a phone would each be a smudge.',
    },
    {
      name: 'description',
      type: 'string',
      description:
        'What the whole group says, in Spanish. Required — it is the only voice in the mosaic, since every cell is silent.',
    },
    {
      name: 'plate',
      type: 'boolean',
      description:
        'Puts each cell IMAGE on a white plate — rounded, with 12% padding — so it is the img that is plated, not the cell: a Figure caption stays off it, and a cell holding no image gets nothing. For brand marks, which are drawn to sit on white and are often monochrome: served through <img> they never see the page currentColor, so unplated they paint black and vanish on the dark theme. Opt-in because the other kind of mosaic is the opposite — diagrams drawn for the page, transparent and coloured to clear both grounds, which a plate would box in for nothing.',
    },
    {
      name: 'children',
      type: 'MDX',
      description:
        'The cells. Figures, usually, but the grid does not care what they are: it holds anything, which is what keeps <Figure> free of props about its neighbours.',
    },
  ],
  examples: [
    {
      title: 'A 2x2 group described once',
      code: `<Mosaic columns={2} description="Empresas que usan estructuras de datos a diario">
  <Figure src="./logos/una.svg" alt="" />
  <Figure src="./logos/otra.svg" alt="" />
  <Figure src="./logos/tercera.svg" alt="" />
  <Figure src="./logos/cuarta.svg" alt="" />
</Mosaic>`,
      render: () => (
        <Mosaic columns={2} description={GROUP}>
          {cells(4)}
        </Mosaic>
      ),
    },
    {
      title: 'Nine cells on a slide',
      code: `<Mosaic columns={3} description="Nueve lenguajes de programación">
  ... nine figures
</Mosaic>`,
      render: () => (
        // Staged in presentation mode, because the height budget only applies
        // there: three rows of full-width cells overflow a projector, and the
        // deck answers an oversized slide by scaling the whole thing — text
        // included. The cap is per row, so this is the case that sets it.
        <ModeProvider mode="presentation">
          <Mosaic columns={3} description="Nueve veces la misma curva, a modo de ejemplo">
            {cells(9)}
          </Mosaic>
        </ModeProvider>
      ),
    },
    {
      title: 'Given no description',
      code: `<Mosaic columns={3}>
  <Figure src="./logos/una.svg" alt="" />
</Mosaic>`,
      render: () => <Mosaic columns={3}>{cells(3)}</Mosaic>,
    },
  ],
};
