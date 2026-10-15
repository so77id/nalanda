import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { OrderRule } from './OrderRule';

const INORDER = 'La regla del inorden: el subárbol izquierdo, después la raíz, después el derecho.';

describe('OrderRule', () => {
  it('is one image, named by its label', () => {
    render(<OrderRule parts={['izquierda', 'raíz', 'derecha']} label={INORDER} />);
    expect(screen.getByRole('img', { name: INORDER })).toBeTruthy();
  });

  it('writes the parts in order, joined by arrows', () => {
    const { container } = render(
      <OrderRule parts={['izquierda', 'raíz', 'derecha']} label={INORDER} />,
    );
    const parts = [...container.querySelectorAll('[data-part]')].map((p) => p.textContent);
    expect(parts).toEqual(['izquierda', 'raíz', 'derecha']);
    expect(container.textContent).toBe('izquierda→raíz→derecha');
  });

  it('draws in the colour of its traversal', () => {
    const { container } = render(
      <OrderRule parts={['izquierda', 'raíz', 'derecha']} tone="accent" label={INORDER} />,
    );
    const part = container.querySelector('[data-part]') as HTMLElement;
    expect(part.style.border).toContain('var(--color-accent)');
  });

  it('draws the same in the book and on a slide', () => {
    const book = render(
      <ModeProvider mode="book">
        <OrderRule parts={['nodo', 'hijos']} label="La regla del preorden." />
      </ModeProvider>,
    ).container.innerHTML;
    const slide = render(
      <ModeProvider mode="presentation">
        <OrderRule parts={['nodo', 'hijos']} label="La regla del preorden." />
      </ModeProvider>,
    ).container.innerHTML;
    expect(slide).toBe(book);
  });

  it('tells the author when the label is missing', () => {
    const { container } = render(<OrderRule parts={['nodo', 'hijos']} label="" />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when there is nothing to put in order', () => {
    const { container } = render(<OrderRule parts={['nodo']} label="Una sola parte." />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});
