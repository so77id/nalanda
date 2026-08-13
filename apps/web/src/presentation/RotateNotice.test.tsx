import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RotateNotice } from './RotateNotice';

describe('RotateNotice', () => {
  it('tells the reader, in Spanish, to turn the phone', () => {
    render(<RotateNotice />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/gira el (teléfono|celular)/i);
  });

  it('is announced to assistive technology: a named alert dialog holding the focus', () => {
    render(<RotateNotice />);
    const panel = screen.getByRole('alertdialog');
    expect(panel).toHaveAccessibleName(/gira el (teléfono|celular)/i);
    expect(panel).toHaveAttribute('aria-modal', 'true');
    // Announced on arrival, which is what makes it reachable at all: it appears
    // without the reader acting, and nothing else on the route is rendered.
    expect(panel).toHaveFocus();
  });
});
