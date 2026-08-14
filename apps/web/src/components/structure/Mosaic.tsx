import type { ReactNode } from 'react';

import { AuthoringError } from '../AuthoringError';
import { DescribedProvider } from '../described';
import { useMode } from '../../presentation';

export interface MosaicProps {
  /** How many cells per row. Required: never inferred from the child count. */
  columns?: 2 | 3 | 4;
  /** What the whole group says, in Spanish. Required — it is the only voice here. */
  description?: string;
  /** The cells: figures, usually, but the grid does not care what they are. */
  children?: ReactNode;
}

// Written out rather than composed, because Tailwind reads these classes as
// literals: a template string builds a name no stylesheet ever contains.
const GRID = {
  2: { book: 'grid-cols-2', slide: 'grid-cols-2' },
  3: { book: 'grid-cols-2 md:grid-cols-3', slide: 'grid-cols-3' },
  4: { book: 'grid-cols-2 md:grid-cols-4', slide: 'grid-cols-4' },
} as const;

/**
 * Several blocks in a grid, described once as a group.
 *
 * Built for the logo mosaics of the opening class — nine companies, nine
 * languages — where the picture is the set and not any of its members. So the
 * container carries the accessible name and the cells go silent: `<Figure>`
 * accepts an empty `alt` only inside one of these, and refuses it everywhere
 * else.
 *
 * It holds anything, not only images: the grid does not know what a cell is,
 * which is what keeps `<Figure>` free of props about its neighbours.
 */
export function Mosaic({ columns, description, children }: MosaicProps) {
  const mode = useMode();

  if (columns === undefined) {
    return (
      <AuthoringError component="Mosaic">
        necesita columns con el número de columnas (2, 3 o 4).
      </AuthoringError>
    );
  }
  if (description === undefined || description === '') {
    return (
      <AuthoringError component="Mosaic">
        necesita description: es lo único que describe el conjunto, porque sus celdas van mudas.
      </AuthoringError>
    );
  }

  return (
    // A figure with a label, not a bare div: the group needs one accessible name
    // and this is the element that has one without inventing a role.
    <figure
      aria-label={description}
      className={`measure-full my-6 grid items-center gap-4 ${GRID[columns][mode === 'presentation' ? 'slide' : 'book']}`}
    >
      <DescribedProvider value={true}>{children}</DescribedProvider>
    </figure>
  );
}
