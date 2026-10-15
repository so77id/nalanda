import type { SequenceCell } from './sequenceStepperTrace';

/**
 * The colour of every cell state, shared by the painters of
 * `<SequenceStepper>`: the Sequence picture (`SequenceStepper.tsx`), the
 * heap's (`sequenceStepperHeapView.tsx`) and the tree's
 * (`sequenceStepperTreeView.tsx`). One table, so a state cannot read as one
 * thing in a chain and another in a heap or a tree.
 */
export const CELL_FILL: Record<SequenceCell['state'], string> = {
  idle: 'var(--color-surface)',
  // `mark`, not `keep`: a node the operation just inserted is not a SUCCESS,
  // it is the thing to look at now. `keep` stays for the search hit, which
  // genuinely is one. ADR-0026 §Addendum — #288.
  new: 'var(--color-mark-soft)',
  active: 'var(--color-surface)',
  found: 'var(--color-keep-soft)',
  leaving: 'var(--color-sunk)',
  stale: 'var(--color-surface)',
  swap: 'var(--color-surface)',
  visited: 'var(--color-sunk)',
  discarded: 'var(--color-surface)',
};

export const CELL_STROKE: Record<SequenceCell['state'], string> = {
  idle: 'var(--color-rule)',
  new: 'var(--color-mark)',
  active: 'var(--color-focus)',
  found: 'var(--color-keep)',
  leaving: 'var(--color-rule)',
  stale: 'var(--color-rule)',
  // Accent, the unit's "being moved" token (teach-a-data-structure.md §6bis)
  // — Sedgewick's orange path of the element that swims or sinks.
  swap: 'var(--color-accent)',
  visited: 'var(--color-rule-strong)',
  discarded: 'var(--color-rule)',
};

/**
 * Colour is never the only signal (`design-system.md`): every state that is
 * painted also gets a word under the box, so a reader who cannot separate the
 * hues still reads what happened. The heap view writes no word under its
 * cells — its index sits there — and reads `swap` by stroke weight and the
 * legend instead (ADR-0077 §4).
 */
export const CELL_NOTE: Partial<Record<SequenceCell['state'], string>> = {
  new: 'nuevo',
  found: '✓ este',
  leaving: 'sale',
  stale: 'copia vieja',
};
