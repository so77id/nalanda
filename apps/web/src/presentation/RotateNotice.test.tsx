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

  it('names the gesture the deck will answer to, since a phone has no arrow keys', () => {
    // The panel is the last thing seen before the deck appears, which is why
    // the hint lives here instead of as dismissible chrome inside the deck.
    renderNotice();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/desliza/i);
  });

  it('offers a way out, in Spanish, that lands on the document rather than on history', () => {
    // Not history.back(): a reader who opened /d/<id>/present directly — a link
    // in a message, a bookmark — has nothing behind them to go back to.
    renderNotice('busqueda-binaria');
    const out = screen.getByRole('link', { name: /leer|libro|volver/i });
    expect(out).toHaveAttribute('href', '/d/busqueda-binaria');
  });

  // What "nothing else is reachable" means is a claim about the whole route,
  // not about this component, so it is asserted there — app/presentationRoute
  // .test.tsx, "leaves nothing but the way out reachable by keyboard". Asking
  // the panel whether it contains its own link proves only that the JSX says so.
});
