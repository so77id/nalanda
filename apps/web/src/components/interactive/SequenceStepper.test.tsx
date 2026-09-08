import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { SequenceStepper } from './SequenceStepper';

/**
 * jsdom mocks CodeMirror and lays nothing out, so these cases assert the
 * CONTRACT — which frames exist, what the controls do, what the authoring
 * guards refuse and what the accessible name says. The paint itself (the SVG
 * over both themes, on a slide) is the browser check.
 */

const renderIn = (mode: 'book' | 'presentation', ui: React.ReactElement) =>
  render(<ModeProvider mode={mode}>{ui}</ModeProvider>);

const base = {
  eda: 'linked-list-singly' as const,
  operation: 'insert-first' as const,
  values: [7, 3, 1, 5],
  value: 9,
};

describe('<SequenceStepper> · authoring guards', () => {
  it('refuses a missing recipe and names the ones it knows', () => {
    renderIn('book', <SequenceStepper operation="search" values={[1]} target={1} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.getByText(/linked-list-singly/)).toBeInTheDocument();
  });

  it('refuses an unknown recipe', () => {
    renderIn(
      'book',
      <SequenceStepper eda="skip-list" operation="search" values={[1]} target={1} />,
    );
    expect(screen.getByText(/no es una receta conocida/i)).toBeInTheDocument();
  });

  it('refuses an unknown operation', () => {
    renderIn('book', <SequenceStepper eda="array" operation="rotar" values={[1]} />);
    expect(screen.getByText(/no es una operación conocida/i)).toBeInTheDocument();
  });

  it('refuses insert-ordered over an array, and says why', () => {
    renderIn(
      'book',
      <SequenceStepper eda="array" operation="insert-ordered" values={[1, 2]} target={3} />,
    );
    expect(screen.getByText(/no está definida sobre/i)).toBeInTheDocument();
  });

  it('refuses an index outside the structure', () => {
    renderIn(
      'book',
      <SequenceStepper eda="linked-list-singly" operation="remove-at" values={[1, 2]} index={9} />,
    );
    expect(screen.getByText(/fuera del rango/i)).toBeInTheDocument();
  });

  it('refuses an unsorted list for insert-ordered', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-singly"
        operation="insert-ordered"
        values={[5, 1, 9]}
        target={3}
      />,
    );
    expect(screen.getByText(/ordenada/i)).toBeInTheDocument();
  });

  it('refuses more values than the picture can hold', () => {
    renderIn('book', <SequenceStepper {...base} values={[1, 2, 3, 4, 5, 6, 7, 8, 9]} />);
    expect(screen.getByText(/elementos/i)).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the frames', () => {
  it('starts paused on the first step and does not autoplay by default', () => {
    renderIn('book', <SequenceStepper {...base} />);
    expect(screen.getByRole('figure')).toHaveAttribute('data-step', '0');
    expect(screen.getByRole('button', { name: /reproducir/i })).toBeInTheDocument();
  });

  it('walks forward and back through the trace', async () => {
    const user = userEvent.setup();
    renderIn('book', <SequenceStepper {...base} />);
    const figure = screen.getByRole('figure');

    await user.click(screen.getByRole('button', { name: /adelante/i }));
    expect(figure).toHaveAttribute('data-step', '1');
    await user.click(screen.getByRole('button', { name: /atrás/i }));
    expect(figure).toHaveAttribute('data-step', '0');
  });

  it('reset returns to the first frame', async () => {
    const user = userEvent.setup();
    renderIn('book', <SequenceStepper {...base} />);
    const figure = screen.getByRole('figure');
    await user.click(screen.getByRole('button', { name: /adelante/i }));
    await user.click(screen.getByRole('button', { name: /reiniciar/i }));
    expect(figure).toHaveAttribute('data-step', '0');
  });

  it('announces the structure in Spanish for a reader who cannot see the SVG', () => {
    renderIn('book', <SequenceStepper {...base} />);
    const picture = screen.getByTestId('sequence-structure');
    expect(picture.getAttribute('aria-label')).toMatch(/La cadena contiene 7, 3, 1, 5/);
  });

  it('narrates each step in a live region', () => {
    // Asked for by test id, not by the aria-live selector: jsdom's CodeMirror
    // mock renders a live region of its own, and it comes first in the DOM.
    renderIn('book', <SequenceStepper {...base} />);
    const live = screen.getByTestId('sequence-narration');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(within(live).getByText(/Creamos el nodo 9/)).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · per mode', () => {
  it.each(['book', 'presentation'] as const)('renders the widget in %s mode', (mode) => {
    renderIn(mode, <SequenceStepper {...base} />);
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute('data-mode', mode);
    expect(figure).toHaveAttribute('data-recipe', 'linked-list-singly');
    expect(figure).toHaveAttribute('data-operation', 'insert-first');
  });

  it('hides the code panel when the slide already carries the listing', () => {
    const { container } = renderIn('book', <SequenceStepper {...base} showCode={false} />);
    expect(container.textContent).not.toMatch(/código/);
    expect(screen.getByTestId('sequence-structure')).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the runtime identity trap', () => {
  // MDX re-mints `values` on every parent re-render. A memo or reset effect
  // keyed on the ARRAY would snap playback back to step 0 mid-run (#266).
  it('survives a parent re-render with a fresh array of the same content', async () => {
    const user = userEvent.setup();
    const { rerender } = renderIn('book', <SequenceStepper {...base} />);
    await user.click(screen.getByRole('button', { name: /adelante/i }));
    expect(screen.getByRole('figure')).toHaveAttribute('data-step', '1');

    rerender(
      <ModeProvider mode="book">
        <SequenceStepper {...base} values={[7, 3, 1, 5]} />
      </ModeProvider>,
    );
    expect(screen.getByRole('figure')).toHaveAttribute('data-step', '1');
  });

  it('does reset when the author actually changes the operation', async () => {
    const user = userEvent.setup();
    const { rerender } = renderIn('book', <SequenceStepper {...base} />);
    await user.click(screen.getByRole('button', { name: /adelante/i }));

    rerender(
      <ModeProvider mode="book">
        <SequenceStepper {...base} operation="search" target={1} />
      </ModeProvider>,
    );
    expect(screen.getByRole('figure')).toHaveAttribute('data-step', '0');
  });
});
