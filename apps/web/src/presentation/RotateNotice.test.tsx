import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { RotateNotice } from './RotateNotice';

function renderNotice(docId = 'java-desde-cpp') {
  render(
    <MemoryRouter>
      <RotateNotice docId={docId} />
    </MemoryRouter>,
  );
}

describe('RotateNotice', () => {
  it('tells the reader, in Spanish, to turn the phone', () => {
    renderNotice();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/gira el (teléfono|celular)/i);
  });

  it('is announced to assistive technology: a named alert dialog holding the focus', () => {
    renderNotice();
    const panel = screen.getByRole('alertdialog');
    expect(panel).toHaveAccessibleName(/gira el (teléfono|celular)/i);
    expect(panel).toHaveAttribute('aria-modal', 'true');
    // Announced on arrival, which is what makes it reachable at all: it appears
    // without the reader acting, and nothing else on the route is rendered.
    expect(panel).toHaveFocus();
  });

  it('offers a way out, in Spanish, that lands on the document rather than on history', () => {
    // Not history.back(): a reader who opened /d/<id>/present directly — a link
    // in a message, a bookmark — has nothing behind them to go back to.
    renderNotice('busqueda-binaria');
    const out = screen.getByRole('link', { name: /leer|libro|volver/i });
    expect(out).toHaveAttribute('href', '/d/busqueda-binaria');
  });

  it('keeps the way out reachable by keyboard from the panel', () => {
    renderNotice();
    const panel = screen.getByRole('alertdialog');
    const out = screen.getByRole('link', { name: /leer|libro|volver/i });
    expect(panel).toContainElement(out);
    expect(out).not.toHaveAttribute('tabindex', '-1');
  });
});
