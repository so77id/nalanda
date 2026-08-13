import { act, render, screen } from '@testing-library/react';
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

  it('leaves focus alone when the page re-renders around it', async () => {
    // The trap must be set up once per open. Keyed on `onClose` — which callers
    // pass as an inline arrow, a new identity every render — it was torn down
    // and rebuilt on any parent re-render, and the rebuild moved focus: the
    // reader lost the field they were typing in the moment the lazy document
    // landed underneath the drawer.
    const user = userEvent.setup();
    render(<ReRenderingHarness />);
    await user.click(screen.getByRole('button', { name: 'Abrir índice' }));

    const field = screen.getByRole('textbox');
    await user.click(field);
    expect(field).toHaveFocus();

    // Triggered without a click: the real cause is the page re-rendering under
    // the drawer (the lazy document landing, the section spine arriving), not
    // the reader touching anything — and clicking would move focus by itself.
    act(() => repaintPage());

    expect(field).toHaveFocus();
  });

  it('ignores focusables the browser will not visit', async () => {
    // querySelectorAll returns links inside a COLLAPSED <details>; a browser
    // skips them and focus() refuses them. Taken as the trap's last element,
    // Tab from the last VISIBLE control matches nothing, nothing is prevented,
    // and focus leaves the modal — seen in Chromium landing behind the drawer.
    const user = userEvent.setup();
    render(<CollapsedGroupHarness />);
    await user.click(screen.getByRole('button', { name: 'Abrir índice' }));
    const dialog = screen.getByRole('dialog');

    // jsdom does not implement the <details> tab behaviour, so this asserts the
    // list the trap computes rather than the tab walk itself. The real evidence
    // is a browser check (testing-strategy.md).
    const hidden = screen.getByRole('link', { name: 'Escondido' });
    hidden.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    Object.defineProperty(hidden, 'offsetParent', { value: null, configurable: true });

    await user.tab();
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

let repaintPage: () => void = () => {};

function ReRenderingHarness() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  repaintPage = () => setTick((previous) => previous + 1);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir índice</button>
      <span data-testid="tick">{tick}</span>
      {/* Inline arrow on purpose: this is what DocumentPage used to pass. */}
      <Drawer open={open} onClose={() => setOpen(false)} label="Índice del curso">
        <input aria-label="Filtrar" />
        <a href="/d/uno">Uno</a>
      </Drawer>
    </>
  );
}

function CollapsedGroupHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir índice</button>
      <a href="/detras">Detrás del panel</a>
      <Drawer open={open} onClose={() => setOpen(false)} label="Índice del curso">
        <a href="/d/uno">Uno</a>
        <details>
          <summary>Grupo cerrado</summary>
          <a href="/d/escondido">Escondido</a>
        </details>
      </Drawer>
    </>
  );
}
