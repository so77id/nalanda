import type { ReactNode } from 'react';

export interface StepProps {
  /**
   * 1-based line numbers to highlight in the code panel when this step is
   * showing. Empty is legal — a step whose lesson is what appears beside the
   * code, not which line is currently running.
   */
  lines: number[];
  /** Any JSX. Rendered in the visual panel when this step is showing. */
  children?: ReactNode;
}

/**
 * A marker declaring one step of a `<StepShow>`: which lines to highlight and
 * what to draw beside the code.
 *
 * Returns nothing on its own — `<StepShow>` reads its children's props directly
 * and controls what is displayed. Using `<Step>` outside a `<StepShow>` renders
 * nothing, which is the intended failure mode: the pattern IS the pair.
 */
export function Step(_props: StepProps): null {
  return null;
}
