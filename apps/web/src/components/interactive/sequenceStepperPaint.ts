import type { SequenceCell } from './sequenceStepperTrace';

/**
 * The colour of every cell state, shared by the two painters of
 * `<SequenceStepper>`: the Sequence picture (`SequenceStepper.tsx`) and the
 * heap's (`sequenceStepperHeapView.tsx`). One table, so a state cannot read as
 * one thing in a chain and another in a heap.
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
};
