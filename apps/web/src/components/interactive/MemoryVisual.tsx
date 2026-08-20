import { useId, useMemo } from 'react';

import type { MemoryState } from './memoryModel';
import { describeStep, layoutStep } from './memoryLayout';

export interface MemoryVisualProps {
  /** The heap picture to draw: every open frame and every object it references. */
  state: MemoryState;
  /**
   * Object ids whose box changed since the previous step. Optional — the widget
   * paints them with a stronger border so a reader following a walk sees what
   * moved. `<StepShow>` may compute this from the difference between adjacent
   * `<Step>`s; a standalone `<MemoryVisual>` leaves it empty.
   */
  changed?: number[];
}

/**
 * A memory diagram driven by AUTHOR-WRITTEN state — the reversal of ADR-0028.
 *
 * The tracer era (`trace.ts`, deleted in #209 S4) compiled a Java class beside
 * the snippet, ran it, and read back the objects it photographed. The rendering
 * was identical to this one; what changed is where the truth comes from.
 *
 * The pedagogy the tracer bought — the drawing cannot lie about what the code
 * does — is now the AUTHOR's responsibility: no build gate and no test can
 * compare a hand-written figure against the snippet beside it, the blind spot
 * ADR-0028's own §Context described about authored drawings. The ADR that
 * supersedes 0028 (#209 S6) records the trade-off in full: the trace paid for
 * that guarantee in bundle weight and load latency, more than the pedagogy
 * needed at the volumes doc 2 actually uses.
 *
 * The drawing convention (arrows on the right, boxes stacked, cross-frame
 * aliasing described explicitly) is preserved: the algorithm lives in
 * `memoryLayout.ts` and this component is only its renderer.
 *
 * It carries a Spanish description as its accessible name (`role="img"`): the
 * page is served `lang="es"`, and the drawing is the explanation — a reader
 * who cannot see it would otherwise get the prose minus its point.
 */
export function MemoryVisual({ state, changed = [] }: MemoryVisualProps) {
  const layout = useMemo(() => layoutStep(state), [state]);
  const description = useMemo(() => describeStep(state), [state]);
  // Several diagrams can share one page — one <StepShow> can even draw many —
  // and a duplicated marker id would make every arrow on the page resolve to
  // the first one's definition.
  const head = `${useId()}-punta`;

  return (
    <svg
      role="img"
      aria-label={description}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      /*
       * Natural size, and the container scrolls — never scaled to fit.
       * Fitting a tall drawing into a fixed box is what turned a dozen boxes
       * into confetti in the tracer era: measured at 1440px, twenty-four boxes
       * rendered 80px wide with 1px labels. Width is capped so a wide drawing
       * shrinks rather than escaping the column, which costs nothing because
       * drawings are tall, not wide.
       */
      width={layout.width}
      height={layout.height}
      className="block max-w-full"
    >
      <defs>
        <marker
          id={head}
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
          className="fill-accent"
        >
          <path d="M0,0 L7,3.5 L0,7 z" />
        </marker>
      </defs>

      {layout.frames.map((frame) => (
        <g key={frame.name}>
          <rect
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            rx="6"
            className="fill-sunk stroke-rule"
            strokeWidth="1"
          />
          <text
            x={frame.x + 8}
            y={frame.y + 15}
            className="fill-ink-faint font-mono text-[10px] tracking-wide uppercase"
          >
            {frame.name}
          </text>
        </g>
      ))}

      {layout.variables.map((variable) => (
        <g key={variable.id}>
          <rect
            x={variable.x}
            y={variable.y + 2}
            width={variable.width}
            height={variable.height - 4}
            rx="3"
            className="fill-surface stroke-rule-strong"
            strokeWidth="1"
          />
          <text
            x={variable.x + 8}
            y={variable.y + variable.height / 2 + 4}
            className="fill-ink font-mono text-[11px]"
          >
            {variable.name}
          </text>
          <text
            x={variable.x + variable.width - 8}
            y={variable.y + variable.height / 2 + 4}
            textAnchor="end"
            className={`font-mono text-[11px] ${variable.isNull ? 'fill-ink-faint italic' : 'fill-accent'}`}
          >
            {variable.text ?? ''}
          </text>
        </g>
      ))}

      {layout.objects.map((object) => (
        <g key={object.id}>
          <rect
            x={object.x}
            y={object.y}
            width={object.width}
            height={object.height}
            rx="5"
            className={`fill-surface ${
              changed.includes(object.id) ? 'stroke-accent' : 'stroke-rule-strong'
            }`}
            strokeWidth={changed.includes(object.id) ? '2' : '1'}
          />
          <rect
            x={object.x}
            y={object.y}
            width={object.width}
            height={24}
            rx="5"
            className="fill-sunk"
          />
          <text
            x={object.x + 8}
            y={object.y + 16}
            className="fill-accent font-mono text-[11px] font-medium"
          >
            {object.title}
          </text>

          {object.rows.map((row, index) => (
            <g key={`${row.name}-${index}`}>
              <text
                x={object.x + 10}
                y={object.y + 24 + index * 22 + 15}
                className="fill-ink-faint font-mono text-[11px]"
              >
                {row.name}
              </text>
              <text
                x={object.x + object.width - 10}
                y={object.y + 24 + index * 22 + 15}
                textAnchor="end"
                className={`font-mono text-[11px] ${row.isNull ? 'fill-ink-faint italic' : 'fill-accent'}`}
              >
                {row.text ?? ''}
              </text>
            </g>
          ))}
        </g>
      ))}

      {layout.arrows.map((arrow) => (
        <path
          key={`${arrow.fromId}->${arrow.toId}`}
          // Curved, not straight: two aliases landing on one box arrive from
          // different heights, and two straight lines would overlap into one.
          // A field arrow swings out to the right and comes back onto the far
          // edge, so heap-to-heap links never cross the variable lane.
          d={
            arrow.fromField
              ? `M ${arrow.x1} ${arrow.y1} C ${arrow.x1 + 38} ${arrow.y1}, ${arrow.x2 + 38} ${arrow.y2}, ${arrow.x2 + 2} ${arrow.y2}`
              : `M ${arrow.x1} ${arrow.y1} C ${arrow.x1 + 40} ${arrow.y1}, ${arrow.x2 - 40} ${arrow.y2}, ${arrow.x2 - 2} ${arrow.y2}`
          }
          className={arrow.fromField ? 'stroke-accent/60' : 'stroke-accent'}
          strokeWidth="1.5"
          fill="none"
          markerEnd={`url(#${head})`}
        />
      ))}
    </svg>
  );
}
