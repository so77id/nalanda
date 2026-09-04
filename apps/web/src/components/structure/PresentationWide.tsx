import { useRef, type ReactNode } from 'react';

import { useMode } from '../../presentation';
import { useViewportBreakout } from '../useViewportBreakout';

export interface PresentationWideProps {
  /**
   * Fraction of the viewport width the block should occupy in presentation
   * mode. `1` = full viewport, `0.75` = 75 % centred. Default `1`.
   *
   * Guidance: heavy visuals with a lot of horizontal detail (trees, wide
   * diagrams) can want `1`; a comparison of two visuals side-by-side
   * usually reads better at `0.75` so the frame does not touch the edges.
   */
  fraction?: number;
  /** The block to enlarge — typically a `<SideBySide>`, a table, or a
   * wide visual that the Slide's prose max-width would compress. */
  children?: ReactNode;
}

/**
 * Break a block out of the presentation `<Slide>`'s prose max-width and
 * re-anchor it to `fraction` of the viewport width, staying centred. Book
 * mode leaves it alone. Thin MDX wrapper around `useViewportBreakout` (the
 * same primitive `<SortStepper>` and `<StepShow>` use internally).
 *
 * Used by any MDX slide that hosts a wide comparison the prose column
 * cannot fit — e.g. the "drama del pivote" slide with two divide/combine
 * trees side by side. Not needed for widgets that already break out on
 * their own (`<SortStepper>`, `<StepShow>` and everything built on top).
 */
export function PresentationWide({ fraction = 1, children }: PresentationWideProps) {
  const mode = useMode();
  const isPresentation = mode === 'presentation';
  const outerRef = useRef<HTMLDivElement | null>(null);
  useViewportBreakout(outerRef, {
    enabled: isPresentation,
    fraction,
  });
  return (
    // `not-prose w-full` so in book mode the block ignores the
    // prose column's max-width and takes the full width of its
    // container — same footprint as other widgets like SortStepper.
    // In presentation, useViewportBreakout overrides both anyway.
    <div
      ref={outerRef}
      data-testid="presentation-wide"
      data-fraction={fraction}
      className="not-prose w-full"
    >
      {children}
    </div>
  );
}
