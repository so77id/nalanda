import { STEP_R } from './nodeGraphLayout';

/** The badge's ring: `mark` for the step just drawn, `keep` for the earlier ones. */
export type StepBadgeTone = 'mark' | 'keep';

const RING: Record<StepBadgeTone, string> = {
  mark: 'var(--color-mark)',
  keep: 'var(--color-keep)',
};

export interface StepBadgeProps {
  /** The stroke the number belongs to, by its index among the edges. */
  stroke: number;
  /** The step that drew it, from 1. */
  step: number;
  x: number;
  y: number;
  tone: StepBadgeTone;
}

/**
 * A walk's step number on its stroke: a ring of `STEP_R` with the number
 * inside, at a place `stepMarks` chose. Shared by `<NodeGraph>`'s walks and
 * `<PenTrace>`'s tracings. Hidden from assistive technology: the drawing's
 * accessible name and `<PenTrace>`'s order line say the order in words.
 */
export function StepBadge({ stroke, step, x, y, tone }: StepBadgeProps) {
  return (
    <g data-step={step} data-of={stroke} aria-hidden="true">
      <circle
        cx={x}
        cy={y}
        r={STEP_R}
        style={{ fill: 'var(--color-surface)', stroke: RING[tone] }}
        strokeWidth={1.6}
      />
      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        style={{ fill: 'var(--color-ink)' }}
      >
        {step}
      </text>
    </g>
  );
}
