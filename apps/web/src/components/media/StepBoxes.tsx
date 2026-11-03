import { useId } from 'react';

import { AuthoringError } from '../AuthoringError';
import { STEP_BOX_W, stepBoxesLayout } from './stepBoxesLayout';

/** A box of the chain: what is in it, and the title written over it. */
export interface StepBox {
  /** Over the box. A part between backticks is drawn in the code face: `el objeto \`a\``. */
  title: string;
  /** In the box. */
  text: string;
}

export interface StepBoxesProps {
  /** The values, in order. At least two. */
  boxes: StepBox[];
  /** The step written over the arrow between each pair of boxes: one fewer than the boxes. */
  steps: string[];
  /** Width of every box, for values wider than a short key. Default 120. */
  boxWidth?: number;
  caption?: string;
  /** What the figure shows, in Spanish: its accessible name. Required. */
  label: string;
}

/** A title, with each part between backticks in the code face, as the course writes code in prose. */
function codeText(text: string) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith('`') ? (
      <tspan key={i} fontFamily="var(--font-mono, monospace)" fontWeight="700">
        {part.slice(1, -1)}
      </tspan>
    ) : (
      part
    ),
  );
}

/**
 * The steps from one value to the next, each value in a box and each step
 * written over the arrow between two: a key, the number its type turns it
 * into, the position the table takes from that number.
 *
 * Promoted from a figure local to Tablas Hash when Set y Map became the second
 * document to want it (#353, `add-a-course-document.md` §6e-quater).
 */
export function StepBoxes({ boxes, steps, boxWidth = STEP_BOX_W, caption, label }: StepBoxesProps) {
  const marker = `step-boxes-${useId().replace(/:/g, '')}`;
  if (label === undefined || label === '') {
    return (
      <AuthoringError component="StepBoxes">
        necesita un label que describa el dibujo, en español.
      </AuthoringError>
    );
  }
  if (!Array.isArray(boxes) || boxes.length < 2) {
    return (
      <AuthoringError component="StepBoxes">
        necesita al menos dos cajas que unir con un paso.
      </AuthoringError>
    );
  }
  if (!Array.isArray(steps) || steps.length !== boxes.length - 1) {
    return (
      <AuthoringError component="StepBoxes">
        necesita un paso entre cada par de cajas: con {boxes.length} cajas, {boxes.length - 1}{' '}
        pasos.
      </AuthoringError>
    );
  }
  const { width, height, top, boxW, boxH, gap, boxX } = stepBoxesLayout(
    boxes.length,
    boxWidth,
    caption,
  );
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: '100%',
        maxWidth: `${Math.round(width * 1.3)}px`,
        height: 'auto',
        display: 'block',
        margin: '0.4rem auto',
      }}
      role="img"
      aria-label={label}
    >
      <defs>
        <marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" style={{ fill: 'var(--color-ink-soft)' }} />
        </marker>
      </defs>
      {boxes.map((b, i) => (
        <g key={`b${i}`}>
          <text
            x={boxX[i] + boxW / 2}
            y={top - 9}
            textAnchor="middle"
            fontSize="12"
            style={{ fill: 'var(--color-ink-faint)' }}
          >
            {codeText(b.title)}
          </text>
          <rect
            x={boxX[i]}
            y={top}
            width={boxW}
            height={boxH}
            rx="4"
            style={{ fill: 'var(--color-surface)', stroke: 'var(--color-rule-strong)' }}
            strokeWidth="1.4"
          />
          <text
            x={boxX[i] + boxW / 2}
            y={top + boxH / 2 + 6}
            textAnchor="middle"
            fontSize="16"
            fontWeight="600"
            style={{ fill: 'var(--color-ink)' }}
          >
            {b.text}
          </text>
        </g>
      ))}
      {steps.map((s, i) => (
        <g key={`s${i}`}>
          <line
            x1={boxX[i] + boxW + 6}
            y1={top + boxH / 2}
            x2={boxX[i + 1] - 8}
            y2={top + boxH / 2}
            style={{ stroke: 'var(--color-ink-soft)' }}
            strokeWidth="1.6"
            markerEnd={`url(#${marker})`}
          />
          <text
            x={boxX[i] + boxW + gap / 2}
            y={top + boxH / 2 - 8}
            textAnchor="middle"
            fontSize="13"
            fontFamily="var(--font-mono, monospace)"
            style={{ fill: 'var(--color-ink-soft)' }}
          >
            {s}
          </text>
        </g>
      ))}
      {caption ? (
        <text
          x={width / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize="12"
          style={{ fill: 'var(--color-ink-soft)' }}
        >
          {caption}
        </text>
      ) : null}
    </svg>
  );
}
