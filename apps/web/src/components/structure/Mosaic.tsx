import { Children, type CSSProperties, type ReactNode } from 'react';

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
 * How much of the slide's height the whole grid may take, in vh, before the
 * title and the deck's own chrome start losing room. Split across the rows.
 */
const SLIDE_BUDGET_VH = 64;

/** Cells, ignoring the whitespace MDX contributes between blocks. */
function cellCount(children: ReactNode): number {
  return Children.toArray(children).filter(
    (child) => typeof child !== 'string' || child.trim() !== '',
  ).length;
}

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
  // MDX is not typechecked, so the `2 | 3 | 4` prop type is authoring-time
  // fiction: an author can write `columns={5}`. Without this guard `GRID[5]` is
  // undefined and the `[mode]` index below throws, and with no error boundary in
  // the app (there is none) the throw blanks the WHOLE document, not just this
  // block — worse than the handled `undefined` case. Same runtime-contract
  // reasoning as Figure's required `alt`: a bad value degrades to an
  // AuthoringError. GRID is the single source of truth for which counts are laid
  // out, so the check reads from it rather than repeating 2/3/4.
  if (!Object.hasOwn(GRID, columns)) {
    return (
      <AuthoringError component="Mosaic">necesita columns con el valor 2, 3 o 4.</AuthoringError>
    );
  }
  if (description === undefined || description === '') {
    return (
      <AuthoringError component="Mosaic">
        necesita description: es lo único que describe el conjunto, porque sus celdas van mudas.
      </AuthoringError>
    );
  }

  // The cap is per ROW, so the grid as a whole cannot outgrow the stage: nine
  // cells at full width overflow a 1024x768 projector, and the deck answers an
  // oversized slide by scaling ALL of it down (ADR-0013) — the text with it.
  // Measured: below roughly half scale the body stops being readable.
  const rows = Math.max(1, Math.ceil(cellCount(children) / columns));
  const cellHeight = {
    '--mosaic-cell': `${Math.floor(SLIDE_BUDGET_VH / rows)}vh`,
  } as CSSProperties;

  return (
    // A figure with a label, not a bare div: the group needs one accessible name
    // and this is the element that has one without inventing a role.
    <figure
      aria-label={description}
      style={mode === 'presentation' ? cellHeight : undefined}
      // Filling the cell is a SLIDE rule, and both halves of that were measured:
      // projected at 1024x768 a 160px SVG sits as a smudge in a sea of
      // background, while in the book at 1440 the same `w-full` blew it up to
      // 384px and its lettering came out bigger than the document's own
      // headings. Read off a wall, fill the cell; read from 50cm, keep the size
      // the file was drawn at.
      //
      // `[&_figure]:my-0`: a Figure carries its own vertical rhythm for when it
      // stands alone in prose, and inside a cell that margin is dead space
      // fighting the grid's gap. Measured on a 1024x768 stage: 144px of it
      // across three rows, which took a 3x3 from 54vh to 73vh.
      className={`measure-full my-6 grid items-center gap-4 [&_figure]:my-0 [&_img]:object-contain ${
        mode === 'presentation'
          ? '[&_img]:w-full [&_img]:max-h-[var(--mosaic-cell)]'
          : '[&_img]:max-w-full'
      } ${GRID[columns][mode === 'presentation' ? 'slide' : 'book']}`}
    >
      <DescribedProvider value={true}>{children}</DescribedProvider>
    </figure>
  );
}
