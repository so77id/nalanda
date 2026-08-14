import { useId, useMemo } from 'react';

import type { TraceStep } from './trace';
import { describeStep, layoutStep } from './memoryLayout';

export interface MemoryStateProps {
  step: TraceStep;
  /** Object ids whose box changed since the previous photograph. */
  changed?: number[];
}

/**
 * One photograph of the heap: named variables on the left, boxes on the right,
 * an arrow for every reference.
 *
 * An SVG rather than positioned divs because the arrows are the content — a
 * reference is a line from a name to a box, and that is the whole idea document
 * 2 exists to install. The geometry comes from `layoutStep`, so what happens
 * here is painting and nothing else.
 *
 * It carries a Spanish description as its accessible name (`role="img"`): the
 * page is served `lang="es"`, and the drawing is the explanation — a reader who
 * cannot see it would otherwise get the prose minus its point.
 */
export function MemoryState({ step, changed = [] }: MemoryStateProps) {
  const layout = useMemo(() => layoutStep(step), [step]);
  const description = useMemo(() => describeStep(step), [step]);
  // Several diagrams can share one page, and a duplicated marker id would make
  // every arrow on the page resolve to the first one's definition.
  const head = `${useId()}-punta`;

  return (
    <svg
      role="img"
      aria-label={description}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="block h-auto w-full max-w-full"
      style={{ maxHeight: '22rem' }}
    >
      <defs>
        <marker
          id={head}
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
          className="fill-emerald-400"
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
            className="fill-zinc-800/60 stroke-zinc-700"
            strokeWidth="1"
          />
          <text
            x={frame.x + 8}
            y={frame.y + 15}
            className="fill-zinc-400 font-mono text-[10px] tracking-wide uppercase"
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
            className="fill-zinc-900 stroke-zinc-600"
            strokeWidth="1"
          />
          <text
            x={variable.x + 8}
            y={variable.y + variable.height / 2 + 4}
            className="fill-zinc-100 font-mono text-[11px]"
          >
            {variable.name}
          </text>
          <text
            x={variable.x + variable.width - 8}
            y={variable.y + variable.height / 2 + 4}
            textAnchor="end"
            className={`font-mono text-[11px] ${variable.isNull ? 'fill-zinc-500 italic' : 'fill-amber-300'}`}
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
            className={`fill-zinc-900 ${
              changed.includes(object.id) ? 'stroke-amber-400' : 'stroke-zinc-600'
            }`}
            strokeWidth={changed.includes(object.id) ? '2' : '1'}
          />
          <rect
            x={object.x}
            y={object.y}
            width={object.width}
            height={24}
            rx="5"
            className="fill-zinc-800"
          />
          <text
            x={object.x + 8}
            y={object.y + 16}
            className="fill-sky-300 font-mono text-[11px] font-medium"
          >
            {object.title}
          </text>

          {object.rows.map((row, index) => (
            <g key={`${row.name}-${index}`}>
              <text
                x={object.x + 10}
                y={object.y + 24 + index * 22 + 15}
                className="fill-zinc-400 font-mono text-[11px]"
              >
                {row.name}
              </text>
              <text
                x={object.x + object.width - 10}
                y={object.y + 24 + index * 22 + 15}
                textAnchor="end"
                className={`font-mono text-[11px] ${row.isNull ? 'fill-zinc-500 italic' : 'fill-amber-300'}`}
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
          className={arrow.fromField ? 'stroke-emerald-400/60' : 'stroke-emerald-400'}
          strokeWidth="1.5"
          fill="none"
          markerEnd={`url(#${head})`}
        />
      ))}
    </svg>
  );
}
