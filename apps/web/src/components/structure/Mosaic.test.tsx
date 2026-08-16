import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Figure } from '../media/Figure';
import { Mosaic } from './Mosaic';
import { ModeProvider } from '../../presentation';

const LOGOS = 'Empresas que usan estructuras de datos a diario';
// The named fixture (ADR-0025): the cost curve the opening class carries.
const REAL_ASSET = 'asset:courses/sample-course/costo-busqueda.svg';

function cells(count: number) {
  return Array.from({ length: count }, (_, i) => <Figure key={i} src={REAL_ASSET} alt="" />);
}

describe('Mosaic', () => {
  it('speaks once for the whole group', () => {
    render(
      <Mosaic columns={3} description={LOGOS}>
        {cells(9)}
      </Mosaic>,
    );

    // The decision this component exists to hold: a screen reader announces one
    // sentence, not nine brand names in a row. Nine silent cells and one name.
    expect(screen.getByRole('figure', { name: LOGOS })).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('lets a cell be silent, which nothing else may be', () => {
    // `alt=""` is legal HERE and an authoring error anywhere else (Figure.test):
    // the exception lives in the container that carries the description, so
    // Figure's own rule stays absolute.
    const { container } = render(
      <Mosaic columns={2} description={LOGOS}>
        {cells(4)}
      </Mosaic>,
    );

    expect(container.querySelectorAll('img')).toHaveLength(4);
    expect(container.textContent).not.toContain('<Figure>');
  });

  it('lays the cells out in the number of columns it was given', () => {
    // A class assertion: jsdom lays nothing out. The real grid is a browser
    // check (S6).
    const { container } = render(
      <Mosaic columns={3} description={LOGOS}>
        {cells(9)}
      </Mosaic>,
    );

    expect(container.querySelector('figure')?.className).toContain('md:grid-cols-3');
  });

  it('keeps its grid on a slide and relaxes it in the book', () => {
    const gridFor = (mode: 'book' | 'presentation'): string => {
      const { container } = render(
        <ModeProvider mode={mode}>
          <Mosaic columns={3} description={LOGOS}>
            {cells(9)}
          </Mosaic>
        </ModeProvider>,
      );
      return container.querySelector('figure')?.className ?? '';
    };

    // ADR-0013 scales a slide WHOLE, so a 3x3 stays a 3x3 and shrinks with
    // everything else on it. The book has no such scaling: nine logos across a
    // phone would each be a smudge, so it drops to two columns until there is
    // room.
    expect(gridFor('presentation')).toContain('grid-cols-3');
    expect(gridFor('presentation')).not.toContain('grid-cols-2');
    expect(gridFor('book')).toContain('grid-cols-2');
    expect(gridFor('book')).toContain('md:grid-cols-3');
  });

  it('fills the cell on a slide and keeps the drawn size in the book', () => {
    const classesFor = (mode: 'book' | 'presentation'): string => {
      const { container } = render(
        <ModeProvider mode={mode}>
          <Mosaic columns={2} description={LOGOS}>
            {cells(4)}
          </Mosaic>
        </ModeProvider>,
      );
      return container.querySelector('figure')?.className ?? '';
    };

    // Both halves measured. Projected at 1024x768, four 160px SVGs sat at their
    // intrinsic size: four smudges in a sea of background. In the book at 1440,
    // the same fill blew each one up to 384px and its lettering came out bigger
    // than the document's own headings.
    expect(classesFor('presentation')).toContain('[&_img]:w-full');
    expect(classesFor('book')).not.toContain('[&_img]:w-full');
    expect(classesFor('book')).toContain('[&_img]:max-w-full');
    // And it takes the cell's own vertical rhythm away: a Figure carries `my-6`
    // for standing alone in prose, which inside a cell is dead space fighting
    // the grid's gap. Measured at 1024x768: 144px of it across three rows, a
    // 3x3 going from 54vh to 73vh.
    expect(classesFor('presentation')).toContain('[&_figure]:my-0');
  });

  it('splits the slide height budget across the rows it actually has', () => {
    const budget = (count: number, columns: 2 | 3): string | undefined => {
      const { container } = render(
        <ModeProvider mode="presentation">
          <Mosaic columns={columns} description={LOGOS}>
            {cells(count)}
          </Mosaic>
        </ModeProvider>,
      );
      return container.querySelector('figure')?.getAttribute('style') ?? undefined;
    };

    // The reason a cap exists at all: nine full-width cells overflow a
    // projector, and the deck answers an oversized slide by scaling ALL of it
    // down (ADR-0013), text included. Three rows get a third of the budget
    // each; two rows get half. A fixed cap would starve the small case and
    // still overflow the big one.
    expect(budget(9, 3)).toContain('21vh');
    expect(budget(4, 2)).toContain('32vh');
  });

  it('caps nothing in the book, where the page simply scrolls', () => {
    const { container } = render(
      <Mosaic columns={3} description={LOGOS}>
        {cells(9)}
      </Mosaic>,
    );

    expect(container.querySelector('figure')?.getAttribute('style')).toBeNull();
    expect(container.querySelector('figure')?.className).not.toContain('max-h');
  });

  it('tells the author when there is no description', () => {
    // Without it the mosaic is nine unnamed pictures — the exact outcome the
    // silent cells were chosen to avoid.
    const { container } = render(<Mosaic columns={3}>{cells(9)}</Mosaic>);

    expect(container.textContent).toContain('<Mosaic>');
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('tells the author when the column count is missing', () => {
    // Never inferred from the child count: six figures are 3x2 or 2x3 depending
    // on what the author meant, and guessing picks one silently.
    const { container } = render(<Mosaic description={LOGOS}>{cells(6)}</Mosaic>);

    expect(container.textContent).toContain('<Mosaic>');
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it.each([1, 5, 6])('tells the author when columns is out of range (%s)', (columns) => {
    // MDX is not typechecked, so `columns={5}` compiles and reaches the runtime
    // (the cast here stands in for that untyped author input). Before the guard
    // this threw `Cannot read properties of undefined` on GRID[5] and, with no
    // error boundary, took the whole document down — this asserts it degrades to
    // an AuthoringError instead, the way the missing-count case above does.
    const { container } = render(
      <Mosaic columns={columns as 2 | 3 | 4} description={LOGOS}>
        {cells(4)}
      </Mosaic>,
    );

    expect(container.textContent).toContain('<Mosaic>');
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
