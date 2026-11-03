import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { ChainTable } from './ChainTable';
import { chainTableLayout } from './chainTableLayout';

const TABLE = [['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []];
const LABEL = 'Una tabla de siete posiciones; la posición 2 guarda a Leo y a Ana.';

const texts = (container: HTMLElement) =>
  [...container.querySelectorAll('text')].map((t) => t.textContent);

/** The `<g>` of the node that holds `key`: its own text is the key. */
const node = (container: HTMLElement, key: string) =>
  [...container.querySelectorAll('g')].find(
    (g) => g.querySelector(':scope > text')?.textContent === key,
  ) as SVGGElement;

const errorOf = (container: HTMLElement) => container.querySelector('[data-authoring-error]');

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
      <ChainTable
        chains={TABLE}
        tones={{ Ana: 'keep', Eva: 'mark', Juan: 'flag', Leo: 'visited' }}
        label={LABEL}
      />,
    );
    const rect = (key: string) => node(container, key).querySelector('rect');
    expect(rect('Ana')?.getAttribute('style')).toContain('--color-keep');
    expect(rect('Eva')?.getAttribute('style')).toContain('--color-mark');
    expect(rect('Juan')?.getAttribute('style')).toContain('--color-flag');
    expect(['Ana', 'Eva', 'Juan', 'Leo'].map((k) => rect(k)?.getAttribute('stroke-width'))).toEqual(
      ['2.4', '2.4', '1.2', '1.2'],
    );
  });

  it('strikes the key being removed, dashes its node, and draws the link that skips it', () => {
    const { container } = render(<ChainTable chains={TABLE} cut="Leo" label={LABEL} />);
    const leo = node(container, 'Leo');
    expect(leo.querySelector(':scope > text')?.getAttribute('text-decoration')).toBe(
      'line-through',
    );
    expect(leo.querySelector('rect')?.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(
      node(container, 'Ana').querySelector('rect')?.getAttribute('stroke-dasharray'),
    ).toBeNull();
    expect(container.querySelectorAll('[data-bypass]')).toHaveLength(1);
  });

  it('draws the link that skips a first node or a last one where the layout runs it', () => {
    const layout = chainTableLayout(TABLE);
    for (const [cut, k] of [
      ['Leo', 0],
      ['Ana', 1],
    ] as const) {
      const { container } = render(<ChainTable chains={TABLE} cut={cut} label={LABEL} />);
      const [line, head] = [...container.querySelectorAll('[data-bypass] path')].map((p) =>
        p.getAttribute('d'),
      );
      expect({ line, head }).toEqual(layout.bypass(2, 2, k));
    }
  });

  it('writes a map value under its key', () => {
    const { container } = render(
      <ChainTable
        chains={[['13.180.992-1'], [], ['12.547.354-7', '22.715.853-0']]}
        size="rut"
        values={{ '13.180.992-1': 'mesa 1', '12.547.354-7': 'mesa 2', '22.715.853-0': 'mesa 1' }}
        label="Tres RUT con su mesa."
      />,
    );
    const t = texts(container);
    expect(t.filter((x) => x === 'mesa 1')).toHaveLength(2);
    expect(t).toContain('mesa 2');
  });

  it('numbers the nodes in walk order: position by position, each list from its front', () => {
    const { container } = render(<ChainTable chains={TABLE} order label={LABEL} />);
    const badge = (key: string) =>
      node(container, key).querySelector('[data-order] text')?.textContent;
    expect(TABLE.flat().map(badge)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('draws a key written twice in both its nodes, each counted in its own place', () => {
    const rut = '13.180.992-1';
    const { container } = render(
      <ChainTable
        chains={[[], [rut, rut], [rut]]}
        size="rut"
        tones={{ [rut]: 'mark' }}
        order
        label="El mismo RUT en tres nodos."
      />,
    );
    const badges = [...container.querySelectorAll('[data-order] text')].map((t) => t.textContent);
    expect(badges).toEqual(['1', '2', '3']);
    const strong = [...container.querySelectorAll('rect')].filter(
      (r) => r.getAttribute('stroke-width') === '2.4',
    );
    expect(strong).toHaveLength(3);
  });

  it('draws only a window of positions, with «…» on each side the table goes on', () => {
    const { container } = render(<ChainTable chains={TABLE} window={[1, 3]} label={LABEL} />);
    const t = texts(container);
    expect(t.filter((x) => x === '…')).toHaveLength(2);
    expect(t).not.toContain('Eva');
    expect(t).toContain('Ana');
  });

  it('writes no «…» past an edge of the table a window reaches', () => {
    for (const window of [
      [3, 6],
      [0, 2],
    ] as [number, number][]) {
      const { container } = render(<ChainTable chains={TABLE} window={window} label={LABEL} />);
      expect(texts(container).filter((x) => x === '…')).toHaveLength(1);
    }
  });

  it('writes a backticked part of its caption in the code face', () => {
    const { container } = render(
      <ChainTable chains={TABLE} caption="el `get` de Ana" label={LABEL} />,
    );
    const caption = [...container.querySelectorAll('svg > text')].at(-1);
    expect(caption?.textContent).toBe('el get de Ana');
    expect(caption?.querySelector('tspan')?.textContent).toBe('get');
    expect(caption?.querySelector('tspan')?.getAttribute('font-family')).toContain('mono');
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
    expect(errorOf(container)).not.toBeNull();
  });

  it('tells the author when a tone names a key no list holds', () => {
    const { container } = render(
      <ChainTable chains={TABLE} tones={{ Carla: 'mark' }} label={LABEL} />,
    );
    expect(errorOf(container)).not.toBeNull();
  });

  it('tells the author when the window falls outside the table, and only then', () => {
    const outside = (window: [number, number]) =>
      errorOf(render(<ChainTable chains={TABLE} window={window} label={LABEL} />).container);
    expect(outside([5, 9])).not.toBeNull();
    expect(outside([0, 7])).not.toBeNull();
    expect(outside([3, 2])).not.toBeNull();
    expect(outside([0, 6])).toBeNull();
  });
});
