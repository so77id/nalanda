import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Drawer } from './Drawer';

/** The real arrangement: a toggle outside the drawer, plus focusables inside it. */
function Harness({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir índice</button>
      <button>Otro botón de la página</button>
      <Drawer open={open} onClose={() => setOpen(false)} label="Índice del curso">
        <a href="/d/uno">Uno</a>
        <a href="/d/dos">Dos</a>
      </Drawer>
    </>
  );
}

async function open() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Abrir índice' }));
  return user;
}

describe('Drawer', () => {
  it('shows nothing until it is opened', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Uno' })).not.toBeInTheDocument();
  });

  it('opens as a named dialog', async () => {
    await open();
    expect(screen.getByRole('dialog', { name: 'Índice del curso' })).toBeInTheDocument();
  });

  it('moves focus into the drawer, so the keyboard follows the eye', async () => {
    await open();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('closes on Escape', async () => {
    const user = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns focus to the control that opened it', async () => {
    const user = await open();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Abrir índice' })).toHaveFocus();
  });

  it('closes when the backdrop is clicked', async () => {
    const user = await open();
    await user.click(screen.getByTestId('drawer-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab inside the drawer instead of walking the page behind it', async () => {
    const user = await open();
    const dialog = screen.getByRole('dialog');

    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(
        dialog.contains(document.activeElement),
        `Tab ${i + 1} escaped the drawer to ${(document.activeElement as HTMLElement).outerHTML}`,
      ).toBe(true);
    }
  });

  it('wraps backwards too', async () => {
    const user = await open();
    const dialog = screen.getByRole('dialog');

    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('offers a close control of its own, named for a screen reader', async () => {
    await open();
    expect(screen.getByRole('button', { name: /cerrar/i })).toBeInTheDocument();
  });
});
