import { layoutProbe } from './sequenceStepperHashLayout';
import { CELL_FILL, CELL_STROKE } from './sequenceStepperPaint';
import type { ProbeFrame } from './sequenceStepperTrace';

// ── the probing table: every key in the array itself (#326) ───────────────

/**
 * The probing recipe draws the two arrays the class declares, `keys` and
 * `deleted`, as two contiguous strips, each cell of `deleted` under the key it
 * marks. A key removed stays in its cell, struck through, with `true` under
 * it: the drawing is the code's state, not a picture of it. The cursor `i`
 * walks under the strips; the key looked for and its hash sit over the cell
 * the hash named.
 *
 * Colour is never the only signal: the cell under the eye also has the cursor
 * under it, a marked key is struck through and its `deleted` reads `true`.
 */
export function ProbeView({
  probe,
  buckets,
  description,
  presentation,
}: {
  probe: ProbeFrame;
  buckets: number;
  description: string;
  presentation: boolean;
}) {
  const layout = layoutProbe(buckets);
  const live = probe.cells.filter((c) => c.key !== null && !c.deleted).map((c) => c.key);
  const marked = probe.cells.filter((c) => c.deleted).map((c) => c.key);
  const summary = `Tabla hash con sondeo lineal de ${buckets} posiciones con ${
    live.length === 0
      ? 'ninguna clave'
      : `${live.length} ${live.length === 1 ? 'clave' : 'claves'}: ${live.join(', ')}`
  }${marked.length === 0 ? '' : `; con marca de borrado: ${marked.join(', ')}`}. ${description}`;

  return (
    // `pt-14`: the panel writes `size` and `used` over its top-right corner, and
    // this strip runs the panel's whole width, so the chip over the last cell
    // landed under them (#326, `hash("Julia") = 10`). The drawing starts below.
    <div
      className="flex items-center justify-center overflow-x-auto p-3 pt-14"
      style={{ maxHeight: presentation ? 'min(46vh, 440px)' : undefined }}
    >
      <svg
        data-testid="probe-view"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-auto w-full"
        // On a slide the panel above caps its height and scrolls past it, and
        // a projected slide cannot be scrolled: `100%` of a parent that has
        // only a max-height constrains nothing, so the cap is restated here,
        // less the panel's padding (p-3, 12px a side). Measured on #326's
        // `add` slide, whose drawing ran 11px past the panel.
        style={{
          maxWidth: `${layout.width * 1.4}px`,
          maxHeight: presentation ? 'calc(min(46vh, 440px) - 68px)' : '100%',
        }}
        role="img"
        aria-label={summary}
      >
        <defs>
          <marker
            id="probe-arrow-focus"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 z" fill="var(--color-focus)" />
          </marker>
        </defs>

        {(['keys', 'deleted'] as const).map((name) => (
          <text
            key={name}
            x={layout.names[name].x}
            y={layout.names[name].y}
            textAnchor="end"
            fontSize="12"
            fontWeight="700"
            fontFamily="var(--font-mono, monospace)"
            fill="var(--color-ink-soft)"
          >
            {name}
          </text>
        ))}

        {probe.cells.map((cell, i) => {
          const box = layout.cell(i);
          const mark = layout.mark(i);
          const index = layout.index(i);
          const home = probe.home === i;
          const strong = cell.state !== 'idle' && cell.state !== 'visited';
          return (
            <g
              key={i}
              data-cell={i}
              data-key={cell.key ?? undefined}
              data-deleted={cell.deleted || undefined}
              data-state={cell.state}
            >
              <text
                x={index.x}
                y={index.y}
                textAnchor="middle"
                fontSize="11"
                fill={home ? 'var(--color-ink)' : 'var(--color-ink-faint)'}
                fontWeight={home ? 700 : 400}
              >
                {i}
              </text>
              <rect
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                fill={CELL_FILL[cell.state]}
                stroke={CELL_STROKE[cell.state]}
                strokeWidth={strong ? 2.4 : 1.2}
              />
              <text
                x={box.cx}
                y={box.y + box.h / 2 + 5}
                textAnchor="middle"
                fontSize={cell.key === null ? 11 : 14}
                fontWeight={cell.key === null ? 400 : 600}
                fill={
                  cell.key === null || cell.deleted ? 'var(--color-ink-faint)' : 'var(--color-ink)'
                }
                textDecoration={cell.deleted ? 'line-through' : undefined}
              >
                {cell.key ?? 'null'}
              </text>
              <rect
                x={mark.x}
                y={mark.y}
                width={mark.w}
                height={mark.h}
                fill={cell.deleted ? 'var(--color-sunk)' : 'var(--color-surface)'}
                stroke="var(--color-rule-strong)"
                strokeWidth={1}
              />
              <text
                x={mark.cx}
                y={mark.y + mark.h / 2 + 4}
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono, monospace)"
                fontWeight={cell.deleted ? 700 : 400}
                fill={cell.deleted ? 'var(--color-ink)' : 'var(--color-ink-faint)'}
              >
                {cell.deleted ? 'true' : 'false'}
              </text>
            </g>
          );
        })}

        {probe.at === null ? null : (
          <g data-cursor={probe.at}>
            <line
              x1={layout.cursor(probe.at).x}
              y1={layout.cursor(probe.at).tail}
              x2={layout.cursor(probe.at).x}
              y2={layout.cursor(probe.at).tip}
              stroke="var(--color-focus)"
              strokeWidth={2}
              markerEnd="url(#probe-arrow-focus)"
            />
            <text
              x={layout.cursor(probe.at).x}
              y={layout.cursor(probe.at).label}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fontFamily="var(--font-mono, monospace)"
              fill="var(--color-ink-soft)"
            >
              i
            </text>
          </g>
        )}

        {probe.key === '' ? null : <Chip probe={probe} layout={layout} />}
      </svg>
    </div>
  );
}

/** The key the run works with, over the cell its hash names once that line has run. */
function Chip({ probe, layout }: { probe: ProbeFrame; layout: ReturnType<typeof layoutProbe> }) {
  const picked = probe.home !== null;
  const label = picked ? `hash("${probe.key}") = ${probe.home}` : `"${probe.key}"`;
  const box = layout.band(probe.home ?? 0);
  // 13px monospace advances ~7.8px per character; the rest is the pill's padding.
  const w = Math.max(box.w, label.length * 7.8 + 20);
  const x = Math.min(Math.max(box.cx - w / 2, 2), layout.width - w - 2);
  return (
    <g data-key-chip data-picked={picked || undefined}>
      <rect
        x={x}
        y={box.y + 6}
        width={w}
        height={box.h - 12}
        rx={11}
        fill="var(--color-surface)"
        stroke={picked ? 'var(--color-focus)' : 'var(--color-rule-strong)'}
        strokeWidth={picked ? 2 : 1.2}
      />
      <text
        x={x + w / 2}
        y={box.y + box.h / 2 + 5}
        textAnchor="middle"
        fontSize="13"
        fontFamily="var(--font-mono, monospace)"
        fill="var(--color-ink)"
      >
        {label}
      </text>
    </g>
  );
}
