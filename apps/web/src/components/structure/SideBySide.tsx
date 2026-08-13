import { Children, type ReactNode } from 'react';

import { AuthoringError } from '../AuthoringError';
import { EmbeddedProvider } from '../embedded';
import { useMode } from '../../presentation';

export interface SideBySideProps {
  /** Label above the first column. */
  left?: string;
  /** Label above the second column. */
  right?: string;
  /** Exactly two blocks — typically two code fences. */
  children?: ReactNode;
}

const LABEL = 'bg-zinc-800 px-3 py-1 font-mono text-3xs uppercase tracking-wide text-zinc-400';

/**
 * How much smaller code runs inside a column than in a full-width listing.
 *
 * Half the width is all a column gets, and a line the reader has to scroll to
 * finish is a line they read twice. The slide needs the extra step: measured at
 * 1440px, presentation mode gives each column 440px and sets code at 16px, where
 * `System.out.println("Bienvenidos a EDA");` wants 462 — the closing `);` fell
 * off the edge of the slide whose whole job is teaching that line. The book, at
 * 12.8px, fits it in 376 of 376.
 */
const SCALE = { book: 'text-[0.8em]', presentation: 'text-[0.72em]' } as const;

function Column({ label, children }: { label?: string; children: ReactNode }) {
  const mode = useMode();
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-zinc-700">
      {label === undefined ? null : <h4 className={LABEL}>{label}</h4>}
      {/* Each column still scrolls on its own: a long line in one must not widen
          the page, which is what a two-column layout would otherwise do.
          The `[&_pre]` rules flatten a BARE fence — one in a language the
          platform cannot highlight, which stays a <pre> (#85). A fence that
          became a component is told instead: a CSS selector cannot reach inside
          one, and the column would end up with two headers and two borders. */}
      <div
        className={`overflow-x-auto ${SCALE[mode]} [&_pre]:my-0 [&_pre]:rounded-none [&_pre]:border-0`}
      >
        <EmbeddedProvider value={true}>{children}</EmbeddedProvider>
      </div>
    </div>
  );
}

/**
 * Two blocks shown next to each other, stacked on a narrow screen.
 *
 * Written for a course whose students already program: showing the language
 * they know beside the one they are learning is the lesson itself, and putting
 * one listing under the other makes the reader hold the first in their head
 * while reading the second.
 */
export function SideBySide({ left, right, children }: SideBySideProps) {
  // MDX contributes whitespace between blocks; it is not a column.
  const columns = Children.toArray(children).filter(
    (child) => typeof child !== 'string' || child.trim() !== '',
  );

  if (columns.length !== 2) {
    return (
      <AuthoringError component="SideBySide">
        espera exactamente dos bloques; recibió {columns.length}.
      </AuthoringError>
    );
  }

  return (
    <div className="not-prose my-6 grid gap-3 md:grid-cols-2">
      <Column label={left}>{columns[0]}</Column>
      <Column label={right}>{columns[1]}</Column>
    </div>
  );
}
