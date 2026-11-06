import { AuthoringError } from '../AuthoringError';
import { type ChainTableSize, chainTableLayout } from './chainTableLayout';
import { codeText } from './figureText';

/** How a key's node is painted: found (`keep`), the node to look at now — just added, or just changed (`mark`) —, a wrong turn (`flag`), passed over (`visited`). */
export type ChainTableTone = 'keep' | 'mark' | 'flag' | 'visited';

export interface ChainTableProps {
  /**
   * One list per position of the table, each from its first node: `[['Eva'], [], ['Leo', 'Ana']]`.
   * A key may be written twice — a class without its `equals` leaves one RUT in two lists —:
   * its tone and value reach every node that holds it, and `cut` the first one of each list.
   */
  chains: string[][];
  /** `name` for short keys, `rut` for keys as wide as a RUT. Default `name`. */
  size?: ChainTableSize;
  /** The position a search goes to: its cell outlined and its index in bold. */
  picked?: number;
  /** With `picked`, fades every other position. */
  only?: boolean;
  /** A tone per key. */
  tones?: Record<string, ChainTableTone>;
  /** The key being removed: its node — the first of its list, as a list's `remove` takes — struck through, and the link that skips it drawn. */
  cut?: string;
  /** A map's value per key, drawn in a band under the key: the node of a map. */
  values?: Record<string, string>;
  /** Numbers every node in the order a walk over the table meets it: position by position, each list from its front. */
  order?: boolean;
  /** Only the positions from `[0]` to `[1]`, both included, with «…» where the table goes on. */
  window?: [number, number];
  /** A line under the table; a part between backticks is drawn in the code face. */
  caption?: string;
  /** What the figure shows, in Spanish: its accessible name. Required. */
  label: string;
}

const FILL: Record<ChainTableTone, string> = {
  keep: 'var(--color-keep-soft)',
  mark: 'var(--color-mark-soft)',
  flag: 'var(--color-flag-soft)',
  visited: 'var(--color-sunk)',
};
const STROKE: Record<ChainTableTone, string> = {
  keep: 'var(--color-keep)',
  mark: 'var(--color-mark)',
  flag: 'var(--color-flag)',
  visited: 'var(--color-rule-strong)',
};
/** The tones drawn with the widget's strong stroke (`sequenceStepperHashView.tsx`). */
const STRONG = new Set<ChainTableTone>(['keep', 'mark']);

/** The arrowhead at the end of a reference, pointing down onto `y`. */
function Head({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M ${x - 4} ${y - 7} L ${x} ${y - 1} L ${x + 4} ${y - 7} z`}
      style={{ fill: 'var(--color-ink-soft)' }}
    />
  );
}

/** The link that skips a node being removed, where `chainTableLayout`'s `bypass` puts it. */
function Bypass({ line, head }: { line: string; head: string }) {
  return (
    <g data-bypass>
      <path d={line} fill="none" style={{ stroke: 'var(--color-focus)' }} strokeWidth="1.8" />
      <path d={head} style={{ fill: 'var(--color-focus)' }} />
    </g>
  );
}

/**
 * A hash table with chaining drawn still: the table as a contiguous strip with
 * its index, each position's list hanging under its cell, `null` where a list
 * ends — the look of the hash recipe of `<SequenceStepper>`, whose cell and
 * node heights it shares (`hashGeometry.ts`; the key field of `size="rut"` is
 * two units taller), so a figure and the widget beside it read alike.
 *
 * Promoted from the figures local to Tablas Hash (`Chains`) and Set y Map
 * (`ChainTable`) when the second document copied the first (#353,
 * `add-a-course-document.md` §6e-quater).
 */
export function ChainTable(props: ChainTableProps) {
  const {
    chains,
    size = 'name',
    picked,
    only = false,
    tones = {},
    cut,
    values,
    order = false,
  } = props;
  const { window: shown, caption, label } = props;
  if (label === undefined || label === '') {
    return (
      <AuthoringError component="ChainTable">
        necesita un label que describa la tabla, en español.
      </AuthoringError>
    );
  }
  if (!Array.isArray(chains) || chains.length === 0) {
    return (
      <AuthoringError component="ChainTable">
        necesita la lista de cada posición en <code>chains</code>, al menos una.
      </AuthoringError>
    );
  }
  if (shown && (shown[0] < 0 || shown[1] >= chains.length || shown[0] > shown[1])) {
    return (
      <AuthoringError component="ChainTable">
        tiene una ventana [{shown[0]}, {shown[1]}] fuera de sus {chains.length} posiciones.
      </AuthoringError>
    );
  }
  const keys = new Set(chains.flat());
  const stray = Object.keys(tones).find((k) => !keys.has(k));
  if (stray !== undefined) {
    return (
      <AuthoringError component="ChainTable">
        pinta la clave {stray}, que no está en ninguna lista.
      </AuthoringError>
    );
  }
  const layout = chainTableLayout(chains, {
    size,
    values: values !== undefined,
    window: shown,
    caption,
  });
  const { width, height, lo, hi, left, stripW, pitch, cellY, cellH, indexY } = layout;
  const { nodeW, keyH, keyFont, valueH, nodeH, cellX, cx: colX, nodeY, linkY, bypass } = layout;
  // The walk's count before each position: by place, not by key, since a key may be written twice.
  const before = chains.map((_, i) => chains.slice(0, i).flat().length);
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
      {lo > 0 ? (
        <text
          x={left - 12}
          y={cellY + cellH / 2 + 4}
          textAnchor="middle"
          fontSize="13"
          style={{ fill: 'var(--color-ink-faint)' }}
        >
          …
        </text>
      ) : null}
      {hi < chains.length - 1 ? (
        <text
          x={left + stripW + 12}
          y={cellY + cellH / 2 + 4}
          textAnchor="middle"
          fontSize="13"
          style={{ fill: 'var(--color-ink-faint)' }}
        >
          …
        </text>
      ) : null}
      {chains.map((chain, i) => {
        if (i < lo || i > hi) return null;
        const x0 = cellX(i);
        const cx = colX(i);
        const isPicked = picked === i;
        const faded = only && picked !== undefined && !isPicked;
        return (
          <g key={i} opacity={faded ? 0.4 : undefined}>
            <text
              x={cx}
              y={indexY}
              textAnchor="middle"
              fontSize="11"
              fontWeight={isPicked ? 700 : 400}
              style={{ fill: isPicked ? 'var(--color-ink)' : 'var(--color-ink-faint)' }}
            >
              {i}
            </text>
            <rect
              x={x0}
              y={cellY}
              width={pitch}
              height={cellH}
              style={{ fill: 'var(--color-surface)', stroke: 'var(--color-rule-strong)' }}
              strokeWidth="1.2"
            />
            {chain.length === 0 ? (
              <text
                x={cx}
                y={cellY + cellH / 2 + 4}
                textAnchor="middle"
                fontSize="11"
                style={{ fill: 'var(--color-ink-faint)' }}
              >
                null
              </text>
            ) : (
              <g>
                <circle
                  cx={cx}
                  cy={cellY + cellH / 2}
                  r="3"
                  style={{ fill: 'var(--color-ink-soft)' }}
                />
                <line
                  x1={cx}
                  y1={cellY + cellH / 2}
                  x2={cx}
                  y2={nodeY(0) - 2}
                  style={{ stroke: 'var(--color-ink-soft)' }}
                  strokeWidth="1.4"
                />
                <Head x={cx} y={nodeY(0)} />
              </g>
            )}
            {chain.map((key, k) => {
              const y = nodeY(k);
              const tone = tones[key];
              const leaving = key === cut && k === chain.indexOf(cut);
              const fill = leaving
                ? 'var(--color-sunk)'
                : tone
                  ? FILL[tone]
                  : 'var(--color-surface)';
              const stroke = leaving
                ? 'var(--color-rule)'
                : tone
                  ? STROKE[tone]
                  : 'var(--color-rule)';
              const line = tone ? STROKE[tone] : 'var(--color-rule)';
              return (
                <g key={k}>
                  <rect
                    x={cx - nodeW / 2}
                    y={y}
                    width={nodeW}
                    height={nodeH}
                    rx="3"
                    style={{ fill, stroke }}
                    strokeWidth={leaving || (tone && STRONG.has(tone)) ? 2.4 : 1.2}
                    strokeDasharray={leaving ? '4 3' : undefined}
                  />
                  <line
                    x1={cx - nodeW / 2}
                    y1={y + keyH}
                    x2={cx + nodeW / 2}
                    y2={y + keyH}
                    style={{ stroke: line }}
                    strokeWidth="1"
                  />
                  <text
                    x={cx}
                    y={y + keyH / 2 + 5}
                    textAnchor="middle"
                    fontSize={keyFont}
                    fontWeight="600"
                    textDecoration={leaving ? 'line-through' : undefined}
                    style={{ fill: 'var(--color-ink)' }}
                  >
                    {key}
                  </text>
                  {values ? (
                    <g>
                      <line
                        x1={cx - nodeW / 2}
                        y1={y + keyH + valueH}
                        x2={cx + nodeW / 2}
                        y2={y + keyH + valueH}
                        style={{ stroke: line }}
                        strokeWidth="1"
                      />
                      <text
                        x={cx}
                        y={y + keyH + valueH / 2 + 4}
                        textAnchor="middle"
                        fontSize="11.5"
                        style={{ fill: 'var(--color-ink-soft)' }}
                      >
                        {values[key]}
                      </text>
                    </g>
                  ) : null}
                  {k < chain.length - 1 ? (
                    <g>
                      <circle
                        cx={cx}
                        cy={linkY(k)}
                        r="2.5"
                        style={{ fill: 'var(--color-ink-soft)' }}
                      />
                      <line
                        x1={cx}
                        y1={linkY(k)}
                        x2={cx}
                        y2={nodeY(k + 1) - 2}
                        style={{ stroke: 'var(--color-ink-soft)' }}
                        strokeWidth="1.4"
                      />
                      <Head x={cx} y={nodeY(k + 1)} />
                    </g>
                  ) : (
                    <text
                      x={cx}
                      y={y + nodeH + 13}
                      textAnchor="middle"
                      fontSize="10"
                      style={{ fill: 'var(--color-ink-faint)' }}
                    >
                      null
                    </text>
                  )}
                  {order ? (
                    <g data-order>
                      <circle
                        cx={cx - nodeW / 2}
                        cy={y}
                        r="8.5"
                        strokeWidth="2"
                        style={{ fill: 'var(--color-surface)', stroke: 'var(--color-ink-soft)' }}
                      />
                      <text
                        x={cx - nodeW / 2}
                        y={y + 3.8}
                        textAnchor="middle"
                        fontSize="10.5"
                        fontWeight="700"
                        style={{ fill: 'var(--color-ink)' }}
                      >
                        {before[i] + k + 1}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
            {cut !== undefined && chain.includes(cut) ? (
              <Bypass {...bypass(i, chain.length, chain.indexOf(cut))} />
            ) : null}
            {isPicked ? (
              <rect
                x={x0}
                y={cellY}
                width={pitch}
                height={cellH}
                fill="none"
                style={{ stroke: 'var(--color-focus)' }}
                strokeWidth="2.4"
              />
            ) : null}
          </g>
        );
      })}
      {caption ? (
        <text
          x={width / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize="12"
          style={{ fill: 'var(--color-ink-soft)' }}
        >
          {codeText(caption)}
        </text>
      ) : null}
    </svg>
  );
}
