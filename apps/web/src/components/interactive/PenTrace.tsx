import { RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import {
  NODE_R,
  layoutNodeGraph,
  type NodeGraphEdge,
  type NodeGraphNode,
} from '../nodeGraphLayout';
import {
  EMPTY_TRACE,
  remaining,
  status,
  step,
  undo,
  type TraceState,
  type TraceStatus,
} from './penTraceLogic';

export interface PenTraceProps {
  nodes: NodeGraphNode[];
  /** The strokes, by their two points; the same pair twice is two strokes. */
  edges: NodeGraphEdge[];
  cols: number;
  rows: number;
  /** Draw the points as small dots, the way the figure looks, not as lettered vertices. */
  figure?: boolean;
  /** What the drawing is, in Spanish: its accessible name. Required. */
  label: string;
}

const DOT_R = 6;
/** The invisible circle a press lands on, larger than a dot. */
const HIT_R = 16;

/**
 * A figure to trace without lifting the pen: press a point to put the pen
 * down, then, one after another, the points to draw the strokes to. The pen
 * cannot jump to a point no free stroke reaches, nor go over a stroke twice;
 * the status line says when the tracing is stuck and when it is done, and
 * whether it ended where it began. Drawn on `<NodeGraph>`'s geometry
 * (`nodeGraphLayout.ts`) after `<HanoiPlayground>`'s shape (#356); the rules
 * are the pure `penTraceLogic.ts`.
 */
export function PenTrace(props: PenTraceProps) {
  const { nodes, edges, label } = props;
  if (label === undefined || label === '') {
    return (
      <AuthoringError component="PenTrace">
        necesita un label que describa la figura, en español.
      </AuthoringError>
    );
  }
  const known = new Set(nodes.map((n) => String(n.v)));
  const stray = edges.flatMap((e) => [e[0], e[1]]).find((v) => !known.has(String(v)));
  if (stray !== undefined) {
    return (
      <AuthoringError component="PenTrace">
        tiene un trazo que llega a {String(stray)}, que no está entre los puntos.
      </AuthoringError>
    );
  }
  return <Tracer {...props} />;
}

function Tracer({ nodes, edges, cols, rows, figure = false, label }: PenTraceProps) {
  const [trace, setTrace] = useState<TraceState>(EMPTY_TRACE);
  const [refused, setRefused] = useState(false);
  const layout = layoutNodeGraph({ nodes, edges, cols, rows, directed: false, trim: !figure });
  const { width, drawingH, at } = layout;
  const state = status(edges, trace);
  const start = trace.path[0];
  const here = trace.path[trace.path.length - 1];
  const drawn = new Set(trace.used);

  const press = (v: string) => {
    if (state === 'done') return;
    const next = step(edges, trace, v);
    setRefused(next === null);
    if (next !== null) setTrace(next);
  };
  const reset = (next: TraceState) => {
    setRefused(false);
    setTrace(next);
  };

  const message = say(state, refused, remaining(edges, trace), trace);
  const messageClass =
    state === 'done' ? 'text-keep' : state === 'stuck' || refused ? 'text-flag' : 'text-ink';

  return (
    <div
      data-pen-trace
      data-status={state}
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex flex-wrap items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          sin levantar el lápiz
        </span>
        <span className="ml-auto font-mono text-3xs text-ink-faint">
          trazos: {trace.used.length} / {edges.length}
        </span>
      </header>
      <svg
        viewBox={`0 0 ${width} ${drawingH}`}
        style={{ width: '100%', maxWidth: `${Math.round(width * 1.4)}px`, height: 'auto' }}
        className="mx-auto block"
        role="group"
        aria-label={label}
      >
        {layout.edges.map((e, i) => {
          const done = drawn.has(i);
          return (
            <path
              key={`${e.key}#${i}`}
              data-stroke={i}
              data-drawn={done ? '' : undefined}
              d={e.d}
              fill="none"
              style={{ stroke: done ? 'var(--color-keep)' : 'var(--color-rule-strong)' }}
              strokeWidth={done ? 3.4 : 1.4}
              strokeDasharray={done ? undefined : '4 4'}
              strokeLinecap="round"
            />
          );
        })}
        {nodes.map((n) => {
          const v = String(n.v);
          const { x, y } = at.get(v)!;
          const current = v === here;
          const tone = current ? TONE_OF[state] : null;
          const fill = tone ? `var(--color-${tone}-soft)` : 'var(--color-surface)';
          const stroke = tone ? `var(--color-${tone})` : 'var(--color-rule-strong)';
          const r = figure ? (current ? DOT_R + 2 : DOT_R) : NODE_R;
          return (
            <g
              key={v}
              data-point={v}
              data-current={current ? '' : undefined}
              data-start={v === start ? '' : undefined}
              role="button"
              tabIndex={0}
              aria-label={`Punto ${v}`}
              onClick={() => press(v)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  press(v);
                }
              }}
              style={{ cursor: state === 'done' ? 'default' : 'pointer', outline: 'none' }}
              className="group"
            >
              <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
              {v === start ? (
                <circle
                  cx={x}
                  cy={y}
                  r={r + 5}
                  fill="none"
                  style={{ stroke: 'var(--color-ink-soft)' }}
                  strokeWidth={1.4}
                />
              ) : null}
              <circle
                cx={x}
                cy={y}
                r={r}
                style={{ fill, stroke }}
                strokeWidth={current ? 2.4 : 1.4}
              />
              {figure ? null : (
                <text
                  x={x}
                  y={y + 5}
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="600"
                  style={{ fill: 'var(--color-ink)', pointerEvents: 'none' }}
                >
                  {v}
                </text>
              )}
              <circle
                cx={x}
                cy={y}
                r={r + 9}
                fill="none"
                className="opacity-0 group-focus-visible:opacity-100"
                style={{ stroke: 'var(--color-focus)' }}
                strokeWidth={2}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-2 text-xs">
        <p role="status" aria-live="polite" className={messageClass}>
          {message}
        </p>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => reset(undo(trace))}
            disabled={trace.path.length === 0}
            className={BUTTON}
          >
            <Undo2 size={12} aria-hidden /> Deshacer
          </button>
          <button
            type="button"
            onClick={() => reset(EMPTY_TRACE)}
            disabled={trace.path.length === 0}
            className={BUTTON}
          >
            <RotateCcw size={12} aria-hidden /> Empezar de nuevo
          </button>
        </span>
      </div>
    </div>
  );
}

/** The tone of the point the pen is on: look here, stuck, or finished. */
const TONE_OF: Record<TraceStatus, 'mark' | 'flag' | 'keep'> = {
  empty: 'mark',
  drawing: 'mark',
  stuck: 'flag',
  done: 'keep',
};

const BUTTON =
  'flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** The status line, in the course's voice. */
function say(state: TraceStatus, refused: boolean, left: number, trace: TraceState): string {
  const strokes = (one: string, many: string) => (left === 1 ? one : many);
  if (state === 'empty') return 'Elijamos un punto para bajar el lápiz.';
  if (state === 'done') {
    const closed = trace.path[0] === trace.path[trace.path.length - 1];
    return `Figura completa, sin levantar el lápiz. ${closed ? 'Termina donde empezó.' : 'Termina en otro punto.'}`;
  }
  if (state === 'stuck') {
    return `Sin salida: ${strokes('queda un trazo', `quedan ${left} trazos`)} y ninguno sale de este punto.`;
  }
  if (refused)
    return 'Hasta ese punto no hay un trazo libre: el lápiz no salta ni repite un trazo.';
  return `${strokes('Queda un trazo', `Quedan ${left} trazos`)} por dibujar.`;
}
