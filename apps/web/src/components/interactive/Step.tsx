import type { ReactNode } from 'react';

export interface StepProps {
  /**
   * 1-based line numbers to highlight in the code panel when this step is
   * showing. Empty is legal — a step whose lesson is what appears beside the
   * code, not which line is currently running.
   */
  lines: number[];
  /**
   * 1-based lines to highlight in the `<StepShow>`'s `program` listing, when
   * it has one: the call this step is inside. Ignored without `program`.
   */
  programLines?: number[];
  /**
   * 1-based lines to highlight in the `<StepShow>`'s `helper` listing, the
   * method between the program and the code. Ignored without `helper`.
   */
  helperLines?: number[];
  /**
   * Shown in the CODE column, under the listings: what the program holds after
   * this step — the variables its calls assigned, a value returned — beside
   * the lines that produced it (#363). The code column of a walk with short
   * listings otherwise ends in empty ground. Any step that has one makes room
   * for it in every step, so the column does not jump.
   */
  under?: ReactNode;
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
