import type { ReactNode } from 'react';

/**
 * A labelled strip under an editor: stdin, diagnostics, output, the verdict.
 *
 * Shared by CodeEditor and Exercise because it is the same object in both — the
 * horizontal rule, the small uppercase label, the dark body. It was written
 * twice, identically, and the second copy is how two panels drift apart.
 */
export function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule">
      <h4 className={PANEL_LABEL}>{label}</h4>
      {children}
    </section>
  );
}

/** The panel's own label styling, exported for anything that builds one by hand. */
export const PANEL_LABEL =
  'bg-sunk px-3 py-1 font-mono text-3xs uppercase tracking-wide text-ink-faint';

/**
 * Body styling for panels holding machine text — program output, compiler
 * errors, the cases that ran. `whitespace-pre-wrap` because a compiler's column
 * markers only line up if the spaces survive.
 */
export const OUTPUT = 'm-0 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs';
