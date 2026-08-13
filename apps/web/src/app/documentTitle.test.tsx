import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from './AppRoutes';

/**
 * Pins the WIRING, not the function.
 *
 * `routeTitle.test.ts` proves the pure function computes the right strings, and
 * proves nothing about anyone calling it: deleting `<DocumentTitle />` from
 * `AppRoutes` left the whole suite green while every tab went back to reading
 * "Nalanda". That is the same shape as the plugin list that could be unwired
 * with the suite green — the failure this WP exists to stop repeating.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('the document title, as the shell actually sets it', () => {
  it('names the document being read', async () => {
    renderAt('/d/java-desde-cpp');
    await waitFor(() => expect(document.title).toBe('Java desde C++ · Nalanda'));
  });

  it('names the catalog and its pages', async () => {
    renderAt('/catalog');
    await waitFor(() => expect(document.title).toBe('Catalog · Nalanda'));
  });

  it('follows a navigation rather than only the first load', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await waitFor(() => expect(document.title).toBe('Catalog · Nalanda'));

    await user.click(await screen.findByRole('link', { name: 'Interactivos' }));

    await waitFor(() => expect(document.title).toBe('Interactivos · Catalog · Nalanda'));
  });

  it('leaves a blank-page URL rendering the 404 instead of crashing the app', async () => {
    // `/d/%` is a malformed percent-escape. React Router catches its own decode
    // failure and falls through to the catch-all; the title effect used to throw
    // URIError, and with no error boundary anywhere React unmounted the root —
    // a link anyone can type turned the whole site into a blank page.
    renderAt('/d/%');

    expect(await screen.findByText(/no encontrad|not found/i)).toBeInTheDocument();
    expect(document.title).toBe('Nalanda');
  });
});
