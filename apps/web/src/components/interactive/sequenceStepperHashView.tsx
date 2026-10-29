import { layoutHash, NODE_KEY_H, type HashBox, type HashStrip } from './sequenceStepperHashLayout';
import { CELL_FILL, CELL_NOTE, CELL_STROKE } from './sequenceStepperPaint';
import type { HashFrame, HashFrameNode, HashRun } from './sequenceStepperTrace';

// ── the hash table: one list hanging from each position (#326) ───────────

/**
 * The hash recipe draws `table` as the unit draws every array — a strip of
 * cells with their index — and the list of each position hanging under its
 * cell. The position the hash picked is outlined, with the key it was asked
 * for in the band above it; `add` builds its node in that same band, so the
 * key and the node it becomes sit in one place before the node drops into
 * the front of its list.
 *
 * Colour is never the only signal: the position under the eye also carries
 * `hash = i` in the band, a node that leaves is struck through and dashed,
 * and the references the listing holds are named beside the node they point
 * at.
 *
 * `resize` draws two strips: the old table on the left and the new one on the
 * right, each named as the listing names it — `table` alone before the copy,
 * `table` and `old` while both name the same array, then `old` and `table`.
 */
export function HashView({
  hash,
  run,
  description,
  presentation,
  tall = false,
}: {
  hash: HashFrame;
  run: HashRun;
  description: string;
  presentation: boolean;
  /** Beside its listings (`grow`): the panel takes their height, not the usual cap. */
  tall?: boolean;
}) {
  const cap = tall ? 'min(64vh, 580px)' : 'min(46vh, 440px)';
  const layout = layoutHash(run.buckets, run.longest, run.oldBuckets);
  const keys = hash.chains.flat().map((n) => n.key);
  const oldNote =
    hash.old === undefined
      ? ''
      : ` La tabla vieja, old, tiene ${hash.old.chains.length} posiciones.`;
  const summary = `Tabla hash de ${hash.chains.length} posiciones con ${
    keys.length === 0
      ? 'ninguna clave'
      : `${keys.length} ${keys.length === 1 ? 'clave' : 'claves'}: ${keys.join(', ')}`
  }.${oldNote} ${description}`;
  const fresh = hash.fresh;
  const bucket = hash.bucket;
  const mine = hash.pointers.filter((p) => p.old !== true);
  // `resize` and a `grow` run: which array each strip draws, and under which names.
  const old = layout.old;
  const tableOnLeft =
    layout.below === null &&
    old !== null &&
    hash.old === undefined &&
    hash.chains.length === run.oldBuckets;
  // Stacked (#326, `grow`): the table holds the top strip, and while `resize`
  // runs `old` takes it and the new table is drawn under it. Side by side, a
  // table of the old size is the left strip, and the key, the position it
  // picked and the node add builds go there with it (#331 review).
  const tableStrip = tableOnLeft
    ? old
    : layout.below !== null && hash.old !== undefined
      ? layout.below
      : layout;

  return (
    <div
      className="flex items-center justify-center overflow-x-auto p-3"
      style={{ maxHeight: presentation ? cap : undefined }}
    >
      <svg
        data-testid="hash-view"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-auto w-full"
        // On a slide the panel above caps its height and scrolls past it, and
        // a projected slide cannot be scrolled: `100%` of a parent that has
        // only a max-height constrains nothing, so the cap is restated here,
        // less the panel's padding (p-3, 12px a side). Measured on #326's
        // `add` slide, whose drawing ran 11px past the panel.
        style={{
          maxWidth: `${layout.width * 1.4}px`,
          maxHeight: presentation ? `calc(${cap} - 24px)` : '100%',
        }}
        role="img"
        aria-label={summary}
      >
        <defs>
          <marker id="hash-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="var(--color-ink-soft)" />
          </marker>
          <marker
            id="hash-arrow-new"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 z" fill="var(--color-mark)" />
          </marker>
          <marker
            id="hash-arrow-focus"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 z" fill="var(--color-focus)" />
          </marker>
        </defs>

        {old !== null && hash.old !== undefined ? (
          <Strip
            strip={old}
            chains={hash.old.chains}
            picked={hash.old.bucket}
            pointers={hash.pointers.filter((p) => p.old === true)}
            names={hash.old.aliased ? ['table', 'old'] : ['old']}
          />
        ) : null}
        {hash.old?.aliased === true ? null : (
          <Strip
            strip={tableStrip}
            chains={hash.chains}
            picked={bucket}
            pointers={mine}
            names={old === null ? [] : ['table']}
            fresh={fresh}
            bypass={hash.bypass}
          />
        )}

        {/* The key looked for, over the position its hash named — or, until
            that line runs, over no position at all, at the strip's start. */}
        {fresh !== undefined ? (
          <FreshNode hash={hash} strip={tableStrip} />
        ) : hash.key === '' ? null : (
          <KeyChip
            name={hash.key}
            at={bucket}
            box={tableStrip.band(bucket ?? 0)}
            width={layout.width}
          />
        )}
      </svg>
    </div>
  );
}

type Pointer = HashFrame['pointers'][number];

/** One array: every position of it, and — when the run has two — its name. */
function Strip({
  strip,
  chains,
  picked,
  pointers,
  names,
  fresh,
  bypass,
}: {
  strip: HashStrip;
  chains: HashFrameNode[][];
  picked: number | null;
  pointers: Pointer[];
  names: string[];
  fresh?: HashFrame['fresh'];
  bypass?: HashFrame['bypass'];
}) {
  return (
    <g data-strip={names.join(' ') || 'table'}>
      {names.map((name, k) => (
        <text
          key={name}
          x={strip.name.x}
          y={strip.name.y + (k - (names.length - 1) / 2) * 14}
          textAnchor="end"
          fontSize="12"
          fontWeight="700"
          fontFamily="var(--font-mono, monospace)"
          fill="var(--color-ink-soft)"
        >
          {name}
        </text>
      ))}
      {chains.map((chain, i) => (
        <Column
          key={i}
          bucket={i}
          chain={chain}
          strip={strip}
          picked={picked === i}
          pointers={pointers}
          held={fresh?.held === true && picked === i}
          skip={bypass?.bucket === i ? bypass : undefined}
        />
      ))}
    </g>
  );
}

/** One position: its cell, its index, the list hanging from it and its links. */
function Column({
  bucket,
  chain,
  strip: layout,
  picked,
  pointers,
  held,
  skip,
}: {
  bucket: number;
  chain: HashFrameNode[];
  strip: HashStrip;
  picked: boolean;
  pointers: Pointer[];
  held: boolean;
  skip: HashFrame['bypass'];
}) {
  const cell = layout.cell(bucket);
  const index = layout.index(bucket);
  const empty = chain.length === 0;

  return (
    <g data-bucket={bucket} data-picked={picked || undefined}>
      <rect
        x={cell.x}
        y={cell.y}
        width={cell.w}
        height={cell.h}
        rx={3}
        fill="var(--color-surface)"
        stroke={picked ? 'var(--color-focus)' : 'var(--color-rule-strong)'}
        strokeWidth={picked ? 2.4 : 1.2}
      />
      {/* What `table[i]` holds: null, or a reference drawn as a dot and an
          arrow. While `table[i] = fresh` has run and the node has not landed,
          the reference goes UP, to the node built in the band. */}
      {empty && !held ? (
        <text
          x={cell.cx}
          y={layout.nullAt(bucket, 0).y}
          textAnchor="middle"
          fontSize="11"
          fill="var(--color-ink-faint)"
        >
          null
        </text>
      ) : (
        <circle cx={cell.cx} cy={cell.y + cell.h / 2} r={3} fill="var(--color-ink-soft)" />
      )}
      {held ? (
        <line
          x1={cell.cx}
          y1={cell.y + cell.h / 2}
          x2={cell.cx}
          y2={layout.band(bucket).y + layout.band(bucket).h + 2}
          stroke="var(--color-mark)"
          strokeWidth={1.8}
          markerEnd="url(#hash-arrow-new)"
        />
      ) : null}
      {/* After the arrow that may cross it, and haloed in the panel's colour,
          so `table[i] = fresh` never hides which position it is. */}
      <text
        x={index.x}
        y={index.y}
        textAnchor="middle"
        fontSize="11"
        fill={picked ? 'var(--color-ink)' : 'var(--color-ink-faint)'}
        fontWeight={picked ? 700 : 400}
        stroke="var(--color-surface)"
        strokeWidth={4}
        paintOrder="stroke"
      >
        {bucket}
      </text>
      {!empty && !held && !(skip !== undefined && skip.from === null) ? (
        <Link from={{ x: cell.cx, y: cell.y + cell.h / 2 }} to={layout.node(bucket, 0)} />
      ) : null}
      {skip !== undefined && skip.from === null ? (
        <Bypass
          from={{ x: cell.cx + 3, y: cell.y + cell.h / 2 }}
          to={chain[1] === undefined ? null : layout.node(bucket, 1)}
          nullAt={layout.nullAt(bucket, 1)}
          x={layout.bypassX(bucket)}
        />
      ) : null}

      {chain.map((node, k) => {
        const box = layout.node(bucket, k);
        const next = chain[k + 1];
        const skipsHere = skip !== undefined && skip.from === k;
        return (
          <g key={node.id}>
            <NodeBox node={node} box={box} />
            {next !== undefined && !skipsHere ? (
              <Link
                from={{ x: box.cx, y: box.y + NODE_KEY_H + (box.h - NODE_KEY_H) / 2 }}
                to={layout.node(bucket, k + 1)}
              />
            ) : null}
            {skipsHere ? (
              <Bypass
                from={{ x: box.cx + 3, y: box.y + NODE_KEY_H + (box.h - NODE_KEY_H) / 2 }}
                to={chain[k + 2] === undefined ? null : layout.node(bucket, k + 2)}
                nullAt={layout.nullAt(bucket, k + 2)}
                x={layout.bypassX(bucket)}
              />
            ) : null}
            {pointers
              .filter((p) => p.node === node.id)
              .map((p) => (
                <PointerTag key={p.name} name={p.name} box={box} />
              ))}
          </g>
        );
      })}

      {!empty ? (
        <text
          x={layout.nullAt(bucket, chain.length).x}
          y={layout.nullAt(bucket, chain.length).y}
          textAnchor="middle"
          fontSize="10"
          fill="var(--color-ink-faint)"
        >
          null
        </text>
      ) : null}
      {picked
        ? pointers
            .filter((p) => p.node === null)
            .map((p) => {
              const at = layout.nullAt(bucket, chain.length);
              return (
                <text
                  key={p.name}
                  data-pointer={p.name}
                  x={at.x - 12}
                  y={at.y - 11}
                  textAnchor="end"
                  fontSize="10"
                  fontWeight="700"
                  fill="var(--color-ink-soft)"
                  stroke="var(--color-surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {p.name}
                </text>
              );
            })
        : null}
    </g>
  );
}

/** A node of a list: its key, its `next` field under it, its paint and its note. */
function NodeBox({ node, box }: { node: HashFrameNode; box: HashBox }) {
  const strong = node.state !== 'idle' && node.state !== 'visited';
  const note = CELL_NOTE[node.state];
  return (
    <g data-node data-key={node.key} data-state={node.state}>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={3}
        fill={CELL_FILL[node.state]}
        stroke={CELL_STROKE[node.state]}
        strokeWidth={strong ? 2.4 : 1.2}
        strokeDasharray={node.state === 'leaving' ? '4 3' : undefined}
      />
      <line
        x1={box.x}
        y1={box.y + NODE_KEY_H}
        x2={box.x + box.w}
        y2={box.y + NODE_KEY_H}
        stroke={CELL_STROKE[node.state]}
        strokeWidth={1}
      />
      <text
        x={box.cx}
        y={box.y + NODE_KEY_H / 2 + 5}
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        fill="var(--color-ink)"
        textDecoration={node.state === 'leaving' ? 'line-through' : undefined}
      >
        {node.key}
      </text>
      {/* A leaving node is struck through and dashed instead: its right side
          is where the link that skips it runs. */}
      {note === undefined || node.state === 'leaving' ? null : (
        <text
          x={box.x + box.w + 4}
          y={box.y + 12}
          textAnchor="start"
          fontSize="9"
          fill="var(--color-ink-soft)"
        >
          {note}
        </text>
      )}
    </g>
  );
}

/** A `next` (or `table[i]`) reference: from its field straight down to the node it names. */
function Link({ from, to }: { from: { x: number; y: number }; to: HashBox }) {
  return (
    <g>
      <circle cx={from.x} cy={from.y} r={2.5} fill="var(--color-ink-soft)" />
      <line
        x1={from.x}
        y1={from.y}
        x2={to.cx}
        y2={to.y - 1}
        stroke="var(--color-ink-soft)"
        strokeWidth={1.4}
        markerEnd="url(#hash-arrow)"
      />
    </g>
  );
}

/**
 * The link that skips a leaving node: out of its field to the right, down past
 * the node, and back into the node after it — or to `null`.
 */
function Bypass({
  from,
  to,
  nullAt,
  x,
}: {
  from: { x: number; y: number };
  to: HashBox | null;
  nullAt: { x: number; y: number };
  x: number;
}) {
  const endY = to === null ? nullAt.y - 4 : to.y + 8;
  const endX = to === null ? nullAt.x + 14 : to.x + to.w + 1;
  return (
    <path
      data-bypass
      d={`M${from.x},${from.y} H${x} V${endY} H${endX}`}
      fill="none"
      stroke="var(--color-focus)"
      strokeWidth={1.8}
      markerEnd="url(#hash-arrow-focus)"
    />
  );
}

/**
 * A reference the listing holds, named over the top-left corner of the node it
 * points at — in the gap between two rows, clear of the link arriving at the
 * node's centre and of the column to its left, which a label written beside
 * the node reached into.
 */
function PointerTag({ name, box }: { name: string; box: HashBox }) {
  return (
    <text
      data-pointer={name}
      x={box.x + 24}
      y={box.y - 6}
      textAnchor="end"
      fontSize="10"
      fontWeight="700"
      fill="var(--color-ink-soft)"
      stroke="var(--color-surface)"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {name}
    </text>
  );
}

/**
 * The key looked for, over the position its hash named — or, until that line
 * runs, over no position, at the strip's start. Both tables draw it (#331
 * review: the probing view carried a copy).
 */
export function KeyChip({
  name,
  at,
  box,
  width,
}: {
  name: string;
  at: number | null;
  box: HashBox;
  width: number;
}) {
  const picked = at !== null;
  const label = picked ? `hash("${name}") = ${at}` : `"${name}"`;
  // 13px monospace advances ~7.8px per character; the rest is the pill's padding.
  const w = Math.max(box.w, label.length * 7.8 + 20);
  // Centred over its position, but never past either edge of the canvas.
  const x = Math.min(Math.max(box.cx - w / 2, 2), width - w - 2);
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

/**
 * The node `add` builds, in the band over its position: drawn as a real node
 * because its `next` field is what the next line assigns. Its link to the old
 * first node runs down the right of the column, past the cell.
 */
function FreshNode({ hash, strip: layout }: { hash: HashFrame; strip: HashStrip }) {
  const fresh = hash.fresh!;
  const bucket = hash.bucket ?? 0;
  const box = layout.band(bucket);
  const node: HashFrameNode = { id: fresh.id, key: fresh.key, state: 'new' };
  const linkY = box.y + NODE_KEY_H + (box.h - NODE_KEY_H) / 2;
  const first = hash.chains[bucket]![0];
  return (
    <g data-fresh>
      <NodeBox node={node} box={box} />
      {fresh.next === undefined ? null : fresh.next === null ? (
        <text
          x={box.x + box.w + 6}
          y={linkY + 4}
          textAnchor="start"
          fontSize="10"
          fill="var(--color-ink-faint)"
        >
          → null
        </text>
      ) : first === undefined ? null : (
        <path
          d={`M${box.cx + 3},${linkY} H${layout.bypassX(bucket)} V${layout.node(bucket, 0).y + 8} H${
            layout.node(bucket, 0).x + layout.node(bucket, 0).w + 1
          }`}
          fill="none"
          stroke="var(--color-mark)"
          strokeWidth={1.8}
          markerEnd="url(#hash-arrow-new)"
        />
      )}
    </g>
  );
}
