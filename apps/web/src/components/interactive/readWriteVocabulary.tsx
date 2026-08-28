/**
 * Shared read/write vocabulary for the fib-step widgets
 * (FibMemoSteps, FibTabSteps, FibIterSteps).
 *
 * The three widgets paint cells with the same colour semantics — the
 * cells the current step READ are flagged, the cell it WROTE is
 * accented, empty slots are dashed placeholders, and a small legend
 * under the array names the two colours. This module is the second-use
 * extraction that `frontend-code-style.md §Components` calls for: the
 * previous version deferred it in a comment ("if a third widget needs
 * the same shape, it graduates to a shared module"), then all three
 * widgets shipped in the same WP.
 *
 * The visual shapes DIVERGE — the tabulated / memoized widgets use
 * uniform 3rem × 2.5rem array cells and FibIterSteps uses labelled
 * variable cells — so the shared surface is deliberately narrow:
 * only the colour rule and the legend, not the cell dimensions or
 * layout.
 */

export type ReadWriteState = {
  isRead?: boolean;
  isWrite?: boolean;
  /** When true and neither read nor write, the cell renders as an empty placeholder. */
  dimmed?: boolean;
};

/**
 * The colour rule the three fib-step widgets share for a single cell.
 * Returns the Tailwind class string (border + background + text
 * colour). Priority: write beats read beats dimmed beats the default
 * filled-cell look.
 */
export function readWriteBorderClass({ isRead, isWrite, dimmed }: ReadWriteState): string {
  if (isWrite) return 'border-accent bg-accent-soft text-accent';
  if (isRead) return 'border-flag bg-flag-soft text-flag';
  if (dimmed) return 'border-dashed border-rule/60 text-ink-faint';
  return 'border-rule bg-sunk/40 text-ink';
}

/**
 * The two-colour legend the three fib-step widgets carry under their
 * cells — "leídas" (flag swatch) and "escrita" (accent swatch). Same
 * markup across all three, so it lives here.
 */
export function ReadWriteLegend() {
  return (
    <div className="flex gap-3 text-3xs text-ink-faint">
      <span>
        <span className="mr-1 inline-block h-2 w-2 rounded-sm border border-flag bg-flag-soft" />
        leídas
      </span>
      <span>
        <span className="mr-1 inline-block h-2 w-2 rounded-sm border border-accent bg-accent-soft" />
        escrita
      </span>
    </div>
  );
}
