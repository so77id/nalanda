import { Children, type ReactNode } from 'react';

import { AuthoringError } from '../AuthoringError';

export interface SplitProps {
  /**
   * How the width is divided from the `md` breakpoint up. Even by default; the
   * uneven options exist so a figure need not take half the slide from the text
   * it illustrates.
   */
  ratio?: '50/50' | '60/40' | '40/60';
  /** Exactly two blocks — any two: prose, a figure, a fence, a component. */
  children?: ReactNode;
}

const TEMPLATE = {
  '50/50': 'md:grid-cols-2',
  '60/40': 'md:grid-cols-[3fr_2fr]',
  '40/60': 'md:grid-cols-[2fr_3fr]',
} as const;

/**
 * Two blocks side by side, stacked on a narrow screen.
 *
 * The neutral one: no border, no label, no type scaling, and it does not declare
 * itself a frame — so whatever it holds renders exactly as it would on its own.
 * That is the whole difference from `<SideBySide>`, whose box and chip and
 * `0.72em` are measured for code (ADR-0022, #76) and turn a picture into
 * something that looks like a listing.
 *
 * The two are duplicated layout on purpose and for now: consolidating them would
 * change a component already used in published content, and nothing has yet seen
 * a `Split` in real use. The revisit trigger is recorded in the ADR.
 */
export function Split({ ratio = '50/50', children }: SplitProps) {
  // MDX contributes whitespace between blocks; it is not a column.
  const columns = Children.toArray(children).filter(
    (child) => typeof child !== 'string' || child.trim() !== '',
  );

  if (columns.length !== 2) {
    return (
      <AuthoringError component="Split">
        espera exactamente dos bloques; recibió {columns.length}.
      </AuthoringError>
    );
  }

  return (
    // `measure-full` and not `not-prose` (ADR-0022): the reading measure would
    // narrow the whole layout to 39rem, but a column usually holds running text
    // that must keep its typography.
    // `[&_figure]:my-0` for the same reason a Mosaic does it: a Figure's own
    // vertical rhythm is for standing alone in prose, and inside a column it is
    // dead space fighting the layout's gap.
    <div className={`measure-full my-6 grid items-center gap-6 [&_figure]:my-0 ${TEMPLATE[ratio]}`}>
      <div className="min-w-0">{columns[0]}</div>
      <div className="min-w-0">{columns[1]}</div>
    </div>
  );
}
