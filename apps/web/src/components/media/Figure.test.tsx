import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Figure } from './Figure';

// The named fixture (ADR-0025): the cost curve the opening class carries.
const REAL_ASSET = 'asset:courses/sample-course/costo-busqueda.svg';

describe('Figure', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves an asset key to the url the build emitted', () => {
    render(<Figure src={REAL_ASSET} alt="Dos curvas de costo" />);

    const image = screen.getByRole('img', { name: 'Dos curvas de costo' });
    // Not the key it was handed: what a document writes never reaches the DOM,
    // which is the whole point of the asset pipeline (S1).
    expect(image.getAttribute('src')).not.toBe(REAL_ASSET);
    // Not anchored at the end: what Vite hands back carries its query in dev
    // (`…costo-busqueda.svg?no-inline`) and a content hash in the build.
    expect(image.getAttribute('src')).toMatch(/costo-busqueda[^/]*\.svg/);
  });

  it('shows a caption under the image when given one', () => {
    render(<Figure src={REAL_ASSET} alt="Dos curvas" caption="Costo comparado" />);

    const caption = screen.getByText('Costo comparado');
    expect(caption.tagName).toBe('FIGCAPTION');
  });

  it('renders no caption element when there is no caption', () => {
    const { container } = render(<Figure src={REAL_ASSET} alt="Dos curvas" />);

    expect(container.querySelector('figcaption')).toBeNull();
  });

  it('tells the author when the alt is missing', () => {
    // MDX is not typechecked, so the contract has to hold at render time. An
    // image with no alt is invisible to a screen reader and the reader cannot
    // fix it — the author can.
    const { container } = render(<Figure src={REAL_ASSET} />);

    expect(container.textContent).toContain('<Figure>');
    expect(container.textContent).toMatch(/alt/);
    expect(container.querySelector('img')).toBeNull();
  });

  it('tells the author when the alt is empty', () => {
    // Deliberately not the same as "decorative": a lone figure with an empty
    // alt is an image the document never describes.
    const { container } = render(<Figure src={REAL_ASSET} alt="" />);

    expect(container.textContent).toContain('<Figure>');
    expect(container.querySelector('img')).toBeNull();
  });

  it('tells the author when there is no src', () => {
    const { container } = render(<Figure alt="Dos curvas" />);

    expect(container.textContent).toContain('<Figure>');
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders visibly broken when nothing under content/ matches', () => {
    // Same treatment as an unresolved wiki-link (ADR-0002): writing the slide
    // before drawing the picture is a legitimate order of work.
    const { container } = render(<Figure src="asset:courses/eda/no-existe.svg" alt="Un heap" />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('courses/eda/no-existe.svg');
    expect(console.warn).toHaveBeenCalled();
  });

  it('marks itself out of the reading measure', () => {
    // ADR-0022: a figure is a block, not running text. Without this the measure
    // narrows it to 39rem while the code beside it keeps the full column.
    const { container } = render(<Figure src={REAL_ASSET} alt="Dos curvas" />);

    expect(container.querySelector('figure')?.className).toContain('not-prose');
  });
});
