import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { ChainTable } from './ChainTable';

const TABLE = [['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []];
const LABEL = 'Una tabla de siete posiciones; la posición 2 guarda a Leo y a Ana.';

const texts = (container: HTMLElement) =>
  [...container.querySelectorAll('text')].map((t) => t.textContent);

describe('ChainTable', () => {
  it('is one image, named by its label', () => {
    render(<ChainTable chains={TABLE} label={LABEL} />);
    expect(screen.getByRole('img', { name: LABEL })).toBeTruthy();
  });

  it('draws a cell per position, a node per key, and null where a list ends', () => {
    const { container } = render(<ChainTable chains={TABLE} label={LABEL} />);
    const t = texts(container);
    for (const key of TABLE.flat()) expect(t).toContain(key);
    // five lists end in a node's null, two empty positions hold one in the cell
    expect(t.filter((x) => x === 'null')).toHaveLength(7);
    expect(container.querySelectorAll('rect')).toHaveLength(TABLE.length + TABLE.flat().length);
  });

  it('outlines the picked position and, with only, fades the others', () => {
    const { container } = render(<ChainTable chains={TABLE} picked={2} only label={LABEL} />);
    const faded = container.querySelectorAll('g[opacity="0.4"]');
    expect(faded).toHaveLength(TABLE.length - 1);
    const outline = [...container.querySelectorAll('rect')].find(
      (r) => r.getAttribute('fill') === 'none',
    );
    expect(outline?.getAttribute('style')).toContain('var(--color-focus)');
  });

  it('paints a key by its tone, and only keep and mark with the strong stroke', () => {
    const { container } = render(
      <ChainTable chains={TABLE} tones={{ Ana: 'keep', Leo: 'visited' }} label={LABEL} />,
    );
    const node = (key: string) =>
      [...container.querySelectorAll('g')].find(
        (g) => g.querySelector(':scope > text')?.textContent === key,
      ) as SVGGElement;
    expect(node('Ana').querySelector('rect')?.getAttribute('stroke-width')).toBe('2.4');
    expect(node('Ana').querySelector('rect')?.getAttribute('style')).toContain('--color-keep');
    expect(node('Leo').querySelector('rect')?.getAttribute('stroke-width')).toBe('1.2');
  });

  it('strikes the key being removed and draws the link that skips it', () => {
    const { container } = render(<ChainTable chains={TABLE} cut="Leo" label={LABEL} />);
    const leo = [...container.querySelectorAll('text')].find((t) => t.textContent === 'Leo');
    expect(leo?.getAttribute('text-decoration')).toBe('line-through');
    expect(container.querySelectorAll('[data-bypass]')).toHaveLength(1);
  });

  it('writes a map value under its key, and numbers the nodes in walk order', () => {
    const { container } = render(
      <ChainTable
        chains={[['13.180.992-1'], [], ['12.547.354-7', '22.715.853-0']]}
        size="rut"
        values={{ '13.180.992-1': 'mesa 1', '12.547.354-7': 'mesa 2', '22.715.853-0': 'mesa 1' }}
        order
        label="Tres RUT con su mesa."
      />,
    );
    const t = texts(container);
    expect(t.filter((x) => x === 'mesa 1')).toHaveLength(2);
    expect(t).toEqual(expect.arrayContaining(['1', '2', '3']));
  });

  it('draws only a window of positions, with «…» where the table goes on', () => {
    const { container } = render(<ChainTable chains={TABLE} window={[1, 3]} label={LABEL} />);
    const t = texts(container);
    expect(t.filter((x) => x === '…')).toHaveLength(2);
    expect(t).not.toContain('Eva');
    expect(t).toContain('Ana');
  });

  it('draws the same in the book and on a slide', () => {
    const book = render(
      <ModeProvider mode="book">
        <ChainTable chains={TABLE} picked={2} label={LABEL} />
      </ModeProvider>,
    ).container.innerHTML;
    const slide = render(
      <ModeProvider mode="presentation">
        <ChainTable chains={TABLE} picked={2} label={LABEL} />
      </ModeProvider>,
    ).container.innerHTML;
    expect(slide).toBe(book);
  });

  it('tells the author when the label is missing', () => {
    const { container } = render(<ChainTable chains={TABLE} label="" />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when a tone names a key no list holds', () => {
    const { container } = render(
      <ChainTable chains={TABLE} tones={{ Carla: 'mark' }} label={LABEL} />,
    );
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when the window falls outside the table', () => {
    const { container } = render(<ChainTable chains={TABLE} window={[5, 9]} label={LABEL} />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});
