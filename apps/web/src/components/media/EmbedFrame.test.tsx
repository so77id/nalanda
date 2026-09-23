import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { EmbedFrame } from './EmbedFrame';

const frame = (height: number) => (
  <EmbedFrame height={height} placeholder="Cargando la cosa…">
    <iframe title="La cosa" />
  </EmbedFrame>
);

const heightOf = (container: HTMLElement) =>
  (container.firstElementChild as HTMLElement | null)?.style.height;

describe('EmbedFrame', () => {
  it('takes the height it is given, in the book', () => {
    const { container } = render(frame(900));

    expect(heightOf(container)).toBe('900px');
  });

  // These assert the WHOLE string rather than parts of it. jsdom cannot
  // evaluate `min()`, but it stores the declaration verbatim, and that is
  // enough to pin both halves of the cap. Asserting `toContain('vh')` and
  // `toContain('900px')` was not: `min` -> `max` (which turns the cap into a
  // floor, guaranteeing the oversized slide it exists to prevent) and
  // `64` -> `640` both left the file green (#146). Same shape as
  // Mosaic.test.tsx, which pins its per-row budget as `21vh` / `32vh`.
  it('caps itself against the stage on a slide', () => {
    // A slide is fit and uniformly scaled (ADR-0013 §5.1), so a frame that
    // asks for 900px does not get clipped — it shrinks the whole slide, text
    // included.
    const { container } = render(<ModeProvider mode="presentation">{frame(900)}</ModeProvider>);

    expect(heightOf(container)).toBe('min(900px, 64vh)');
  });

  it('keeps the given number on a slide when it already fits', () => {
    const { container } = render(<ModeProvider mode="presentation">{frame(480)}</ModeProvider>);

    expect(heightOf(container)).toBe('min(480px, 64vh)');
  });

  it('says something is coming while the frame is still transparent', () => {
    // Measured at ~1.6 Mbps: about six seconds of empty bordered box, which
    // reads exactly like the failures an embed cannot detect (an unshared
    // file, the provider down). The placeholder sits UNDER the frame and is
    // covered when the provider paints its own ground.
    const { container } = render(frame(480));

    const hint = screen.getByText('Cargando la cosa…');
    // Not content: the frame already carries the accessible name, so a screen
    // reader must not hear a loading line that never goes away.
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    // Under, not over — otherwise it hides the frame it was announcing.
    expect(hint.compareDocumentPosition(container.querySelector('iframe') as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('marks itself out of the reading measure', () => {
    // ADR-0022: the frame is a block, not running text. Without this it is
    // centred at 39rem in the book while the prose beside it keeps the column.
    const { container } = render(frame(480));

    expect(container.firstElementChild?.className).toContain('not-prose');
  });
});
