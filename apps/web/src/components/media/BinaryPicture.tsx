import type { ReactNode } from 'react';

import { AuthoringError } from '../AuthoringError';
import { TREE_SLOT_H, TREE_SLOT_W } from '../treeGeometry';
import {
  CHIP_GAP,
  chipWidth,
  layoutPicture,
  placeTree,
  repeatedValue,
  sequenceWidth,
  type BinaryTreeShape,
  type PlacedNode,
  type TreeValue,
} from './binaryPictureLayout';

/** How a node is painted. `hidden` keeps its place but draws neither it nor its edge. */
export type BinaryPictureTone =
  'idle' | 'focus' | 'mark' | 'keep' | 'accent' | 'done' | 'faint' | 'hidden';

/** A frame's name, or its name and colour, so two subtrees can be told apart as they move. */
export type BinaryPictureFrame = string | { text: string; tone?: 'keep' | 'accent' | 'mark' };

export interface BinaryPictureProps {
  /** The tree, `{ v, l, r }`: a value per node, unique within the tree, and a side left out when empty. */
  tree: BinaryTreeShape;
  /** What the figure shows, in Spanish: its accessible name. Required. */
  label: string;
  /** The tone of some nodes, keyed by value. */
  tones?: Record<string, BinaryPictureTone>;
  /** A short mark beside some nodes, keyed by value. */
  badges?: Record<string, ReactNode>;
  /** A note under some nodes, keyed by value. */
  notes?: Record<string, ReactNode>;
  /** "nivel 0", "nivel 1", … at the left of every level. */
  levels?: boolean;
  /** The inorder in a strip under the tree, each value under its own node. */
  strip?: boolean;
  /**
   * A binary search's divisions, one row per level under the tree: every node
   * over the stretch of the sorted array it halves — its subtree's columns —
   * with the node, the middle, filled. A level's nodes and stretches share a
   * colour, so the eye follows a split from the tree down to the array. Takes
   * the strip's place: the first row is the whole array.
   */
  splits?: boolean;
  caption?: string;
  /** Scales the drawing's largest size: 0.7 for one beside a listing. */
  size?: number;
  /** Columns to make room for at least, so figures set side by side come out the same size. */
  minColumns?: number;
  /** Narrower columns and levels, for figures set three in a row. */
  compact?: boolean;
  /** Numbers the nodes in this order and draws an arrow from every visit to the next. */
  visits?: 'pre' | 'in' | 'post';
  /** Writes the visit order under the tree as a row of chips. */
  sequence?: boolean;
  /** The empty tree under every missing child, or only under these values. */
  holes?: boolean | TreeValue[];
  /** The height, drawn at the left: "h = 2". */
  ruler?: string;
  /** One note per level, at the right. */
  levelNotes?: string[];
  /** The node just added: its edge is drawn in the mark colour. */
  fresh?: TreeValue;
  /** A word beside the edge that reaches a node, keyed by that node's value. */
  edgeLabels?: Record<string, string>;
  /** A dashed box around the subtree rooted at a node, keyed by that node's value. */
  frames?: Record<string, BinaryPictureFrame>;
  /** The open calls, from the root down: their edges are lit. */
  path?: TreeValue[];
  /** A call that landed on an empty side. */
  probe?: { at: TreeValue; side: 'l' | 'r' };
  /** The two nodes a visit just exchanged, joined by a double-headed arrow. */
  swap?: [TreeValue, TreeValue];
  /** Stops the visits at this value, as a search does when it finds it. */
  until?: TreeValue;
  /** The value a search looks for, written in the top left corner. */
  seek?: TreeValue;
  /** What a drawing with every node hidden says; an empty string says nothing. */
  emptyNote?: string;
  /**
   * Values drawn as a named SUBTREE, a triangle, instead of a node: the
   * generic rotation's A, B and C, which move whole.
   */
  subtrees?: TreeValue[];
  /**
   * A rotation about to happen at a node, drawn as a curved arrow over the
   * edge it turns: clockwise over the edge to the left child for `right`
   * (that child goes up, the node goes down to its right), counterclockwise
   * over the edge to the right child for `left` (#322).
   */
  turn?: { at: TreeValue; dir: 'right' | 'left' };
}

const TONE: Record<Exclude<BinaryPictureTone, 'hidden'>, [string, string, number]> = {
  idle: ['var(--color-surface)', 'var(--color-rule-strong)', 1.3],
  focus: ['var(--color-surface)', 'var(--color-focus)', 2.4],
  mark: ['var(--color-mark-soft)', 'var(--color-mark)', 2.2],
  keep: ['var(--color-keep-soft)', 'var(--color-keep)', 2.2],
  done: ['var(--color-sunk)', 'var(--color-rule-strong)', 1.3],
  // The unit's "being moved" token: the two nodes a rotation exchanges, as
  // the avl recipe of <SequenceStepper> paints them.
  accent: ['var(--color-surface)', 'var(--color-accent)', 2.4],
  faint: ['var(--color-surface)', 'var(--color-rule)', 1.2],
};

/**
 * The colour of each level when the splits are drawn: the soft fill of the
 * middle and the stroke of the stretch. Four, then again from the first; a
 * slide never shows more levels than that.
 */
const SPLIT_TONES = ['accent', 'mark', 'keep', 'focus'] as const;
const SPLIT_SOFT: Record<(typeof SPLIT_TONES)[number], string> = {
  // Surface, as the accent tone paints a node: the middle reads like the root over it.
  accent: 'var(--color-surface)',
  mark: 'var(--color-mark-soft)',
  keep: 'var(--color-keep-soft)',
  focus: 'var(--color-surface)',
};
const splitTone = (depth: number) => SPLIT_TONES[depth % SPLIT_TONES.length]!;

const VISIT_COLOR = {
  pre: 'var(--color-focus)',
  in: 'var(--color-accent)',
  post: 'var(--color-mark)',
} as const;

/**
 * A static drawing of a binary tree, with the geometry of the binary-tree
 * recipe of `<SequenceStepper>`: every node in the column of its inorder
 * position and on the row of its depth, so a figure and the widget beside it
 * draw the same tree (`binaryPictureLayout.ts`). It draws what a class says
 * about a tree beside its code — an order of visits, the open calls of a
 * recursion, an empty call, an exchange, a search — one frame per drawing; the
 * widget is for walking an operation, this is for showing one moment of it.
 *
 * Promoted from a component local to Árboles I when Árboles II became the
 * second document to want it (#322, `add-a-course-document.md` §6e-quater).
 */
export function BinaryPicture(props: BinaryPictureProps) {
  const { tree, label } = props;
  if (label === undefined || label === '') {
    return (
      <AuthoringError component="BinaryPicture">
        necesita un label que describa el árbol, en español.
      </AuthoringError>
    );
  }
  const placed = placeTree(tree);
  const repeated = repeatedValue(placed.nodes);
  if (repeated !== undefined) {
    return (
      <AuthoringError component="BinaryPicture">
        tiene el valor {repeated} dos veces: los tonos, las insignias y las notas se escriben por
        valor, así que cada valor va una sola vez en el árbol.
      </AuthoringError>
    );
  }
  if (props.turn !== undefined) {
    const { at, dir } = props.turn;
    const node = placed.nodes.find((n) => n.key === String(at));
    const child = dir === 'right' ? node?.left : node?.right;
    if (!child) {
      return (
        <AuthoringError component="BinaryPicture">
          gira a la {dir === 'right' ? 'derecha' : 'izquierda'} en {String(at)}, que no tiene{' '}
          {dir === 'right' ? 'hijo izquierdo' : 'hijo derecho'}: la rotación sube a ese hijo, y sin
          él no hay nada que girar.
        </AuthoringError>
      );
    }
  }
  return <Picture {...props} />;
}

function Picture({
  tree,
  tones = {},
  badges = {},
  notes = {},
  levels = false,
  strip = false,
  splits = false,
  caption,
  size = 1,
  minColumns = 0,
  compact = false,
  visits,
  sequence = false,
  holes = false,
  ruler,
  levelNotes,
  fresh,
  edgeLabels = {},
  frames = {},
  path = [],
  probe,
  swap,
  until,
  seek,
  emptyNote = 'root = null',
  subtrees = [],
  turn,
  label,
}: BinaryPictureProps) {
  const placed = placeTree(tree);
  const { root, nodes, depth } = placed;
  const toneOf = (n: PlacedNode) => tones[n.key] ?? (splits ? splitTone(n.depth) : 'idle');

  // The visit sequence, from the recursion itself.
  const seq: PlacedNode[] = [];
  const order = (n: PlacedNode | null) => {
    if (!n) return;
    if (visits === 'pre') seq.push(n);
    order(n.left);
    if (visits === 'in') seq.push(n);
    order(n.right);
    if (visits === 'post') seq.push(n);
  };
  if (visits) order(root);
  const stop = until === undefined ? -1 : seq.findIndex((n) => n.key === String(until));
  if (stop >= 0) seq.length = stop + 1;
  const rank = new Map(seq.map((n, i) => [n, i + 1]));
  const seqColor = VISIT_COLOR[visits ?? 'pre'];

  const c = layoutPicture(placed, {
    compact,
    levels,
    ruler: ruler !== undefined,
    levelNotes: levelNotes !== undefined,
    notes: Object.keys(notes).length > 0,
    holes: holes !== false || probe !== undefined,
    frames: Object.keys(frames).length > 0,
    strip,
    splits,
    sequenceWidth: sequence ? sequenceWidth(seq.map((n) => n.value)) : undefined,
    caption,
    minColumns,
  });
  const { r, offset, labelWidth, drawingWidth, noteWidth, cx, cy, rowY } = c;

  const isSubtree = (n: PlacedNode) => subtrees.some((v) => String(v) === n.key);
  // A subtree drawn as a triangle has no empty children to show.
  const holeAt = (n: PlacedNode) =>
    !isSubtree(n) &&
    (holes === true || (Array.isArray(holes) && holes.some((h) => String(h) === n.key)));
  const find = (v: TreeValue) => nodes.find((n) => n.key === String(v));
  const lit = new Set(path.slice(1).map((v, i) => `${String(path[i])}>${String(v)}`));
  const shown = nodes.filter((n) => toneOf(n) !== 'hidden');
  const levelRows = [...Array(depth + 1).keys()];

  const head = (x: number, y: number, angle: number, color: string, key: string) => (
    <polygon
      key={key}
      points="0,0 -8,-4.5 -8,4.5"
      transform={`translate(${x} ${y}) rotate(${angle})`}
      style={{ fill: color }}
    />
  );
  const dot = (x: number, y: number, k: number, color: string, key: string) => (
    <g key={key}>
      <circle cx={x} cy={y} r="8.5" style={{ fill: color }} />
      <text
        x={x}
        y={y + 3.8}
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="700"
        style={{ fill: 'var(--color-ground)' }}
      >
        {k}
      </text>
    </g>
  );
  // An edge between a parent and a child, trimmed to the two circles.
  const ends = (p: PlacedNode, ch: PlacedNode) => {
    const dx = cx(ch) - cx(p);
    const dy = cy(ch) - cy(p);
    const len = Math.hypot(dx, dy);
    return {
      x1: cx(p) + (dx / len) * r,
      y1: cy(p) + (dy / len) * r,
      x2: cx(ch) - (dx / len) * r,
      y2: cy(ch) - (dy / len) * r,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  };
  // From one visit to the next: along the edge, down to a child or up to the
  // parent; otherwise a dashed jump that leaves the right of one and enters the
  // left of the next, both ends level, so the head points the way the line arrives.
  const step = (a: PlacedNode, b: PlacedNode, key: string) => {
    const down = b.parent === a;
    const up = a.parent === b;
    if (down || up) {
      const e = down ? ends(a, b) : ends(b, a);
      const mx = (e.x1 + e.x2) / 2;
      const my = (e.y1 + e.y2) / 2;
      const rad = (e.angle * Math.PI) / 180;
      const s = down ? 4 : -4;
      return (
        <g key={key}>
          <line
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            style={{ stroke: seqColor }}
            strokeWidth="2.4"
          />
          {head(
            mx + s * Math.cos(rad),
            my + s * Math.sin(rad),
            down ? e.angle : e.angle + 180,
            seqColor,
            `${key}-h`,
          )}
        </g>
      );
    }
    const sx = cx(a) + r + 2;
    const sy = cy(a) + 2;
    const ex = cx(b) - r - 2;
    const ey = cy(b) + 2;
    const d = Math.max(18, (ex - sx) / 2);
    return (
      <g key={key}>
        <path
          d={`M ${sx} ${sy} C ${sx + d} ${sy}, ${ex - d} ${ey}, ${ex - 7} ${ey}`}
          fill="none"
          style={{ stroke: seqColor }}
          strokeWidth="1.8"
          strokeDasharray="5 4"
        />
        {head(ex, ey, 0, seqColor, `${key}-h`)}
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${c.width} ${c.height}`}
      style={{
        width: '100%',
        maxWidth: `${Math.round(c.width * 1.4 * size)}px`,
        height: 'auto',
        display: 'block',
        margin: '1rem auto',
      }}
      role="img"
      aria-label={label}
    >
      {levels
        ? levelRows.map((d) => (
            <g key={`lv${d}`}>
              <line
                x1={offset + labelWidth - 4}
                y1={rowY(d)}
                x2={offset + drawingWidth - noteWidth - 4}
                y2={rowY(d)}
                style={{ stroke: 'var(--color-rule)' }}
                strokeWidth="1"
                strokeDasharray="3 5"
              />
              <text
                x={offset + (ruler ? 50 : 4)}
                y={rowY(d) + 4}
                fontSize="11"
                style={{ fill: 'var(--color-ink-faint)' }}
              >{`nivel ${d}`}</text>
            </g>
          ))
        : null}
      {ruler ? (
        <g>
          <line
            x1={offset + 24}
            y1={rowY(0)}
            x2={offset + 24}
            y2={rowY(depth)}
            style={{ stroke: 'var(--color-ink)' }}
            strokeWidth="1.8"
          />
          {levelRows.map((d) => (
            <line
              key={`rt${d}`}
              x1={offset + 18}
              y1={rowY(d)}
              x2={offset + 30}
              y2={rowY(d)}
              style={{ stroke: 'var(--color-ink)' }}
              strokeWidth="1.8"
            />
          ))}
          <text
            x={offset + 12}
            y={(rowY(0) + rowY(depth)) / 2}
            textAnchor="middle"
            fontSize="13"
            fontWeight="700"
            transform={`rotate(-90 ${offset + 12} ${(rowY(0) + rowY(depth)) / 2})`}
            style={{ fill: 'var(--color-ink)' }}
          >
            {ruler}
          </text>
        </g>
      ) : null}
      {levelNotes
        ? levelNotes.map((note, d) => (
            <text
              key={`ln${d}`}
              x={offset + drawingWidth - noteWidth + 8}
              y={rowY(d) + 4}
              fontSize="12"
              fontWeight="600"
              style={{ fill: 'var(--color-ink-soft)' }}
            >
              {note}
            </text>
          ))
        : null}
      {Object.entries(frames).map(([key, spec]) => {
        const top = find(key);
        if (!top) return null;
        const { text, tone = 'keep' } = typeof spec === 'string' ? { text: spec } : spec;
        const subtree = (n: PlacedNode | null): PlacedNode[] =>
          n ? [n, ...subtree(n.left), ...subtree(n.right)] : [];
        const members = subtree(top);
        const x1 = Math.min(...members.map(cx)) - r - 8;
        const x2 = Math.max(...members.map(cx)) + r + 8;
        const y1 = cy(top) - r - 7;
        // With room kept for empty calls, the box takes it in, so an empty
        // call's box never lands on the frame's name.
        const y2 = Math.max(...members.map(cy)) + r + 7 + c.holeRoom;
        return (
          <g key={`f${key}`} data-frame={key}>
            <rect
              x={x1}
              y={y1}
              width={x2 - x1}
              height={y2 - y1}
              rx="12"
              style={{ fill: `var(--color-${tone}-soft)`, stroke: `var(--color-${tone})` }}
              strokeWidth="1.4"
              strokeDasharray="5 4"
            />
            <text
              x={(x1 + x2) / 2}
              y={y2 + 15}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              style={{ fill: 'var(--color-ink-soft)' }}
            >
              {text}
            </text>
          </g>
        );
      })}
      {shown.map((n) => {
        if (n.parent === null || toneOf(n.parent) === 'hidden') return null;
        const e = ends(n.parent, n);
        const faint = toneOf(n) === 'faint';
        const isFresh = fresh !== undefined && n.key === String(fresh);
        const onPath = lit.has(`${n.parent.key}>${n.key}`);
        return (
          <line
            key={`e${n.key}`}
            data-edge={`${n.parent.key}>${n.key}`}
            data-lit={onPath ? '' : undefined}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            style={{
              stroke: isFresh
                ? 'var(--color-mark)'
                : onPath
                  ? 'var(--color-focus)'
                  : faint
                    ? 'var(--color-rule)'
                    : 'var(--color-rule-strong)',
            }}
            strokeWidth={isFresh || onPath ? 2.6 : 1.3}
            strokeDasharray={faint ? '4 3' : undefined}
          />
        );
      })}
      {shown
        .filter((n) => n.parent !== null && edgeLabels[n.key] !== undefined)
        .map((n) => {
          const e = ends(n.parent!, n);
          const left = n === n.parent!.left;
          return (
            <text
              key={`el${n.key}`}
              x={(e.x1 + e.x2) / 2 + (left ? -8 : 8)}
              y={(e.y1 + e.y2) / 2 + 3}
              textAnchor={left ? 'end' : 'start'}
              fontSize="12"
              fontWeight="700"
              paintOrder="stroke"
              strokeWidth="3"
              style={{ fill: 'var(--color-ink-soft)', stroke: 'var(--color-ground)' }}
            >
              {edgeLabels[n.key]}
            </text>
          );
        })}
      {holes
        ? shown.filter(holeAt).flatMap((n) =>
            (['l', 'r'] as const)
              .filter((side) => {
                const child = side === 'l' ? n.left : n.right;
                return child === null || toneOf(child) === 'hidden';
              })
              .map((side) => {
                const x = cx(n) + (side === 'l' ? -1 : 1) * c.pitch * 0.32;
                const y = cy(n) + r + 14;
                return (
                  <g key={`h${n.key}${side}`} data-hole={`${n.key}-${side}`}>
                    <line
                      x1={cx(n) + (side === 'l' ? -1 : 1) * r * 0.6}
                      y1={cy(n) + r * 0.8}
                      x2={x}
                      y2={y - 4}
                      style={{ stroke: 'var(--color-rule)' }}
                      strokeWidth="1.1"
                      strokeDasharray="2 3"
                    />
                    <rect
                      x={x - 6}
                      y={y - 4}
                      width="12"
                      height="10"
                      rx="2"
                      style={{ fill: 'none', stroke: 'var(--color-rule-strong)' }}
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                  </g>
                );
              }),
          )
        : null}
      {probe && find(probe.at)
        ? (() => {
            const n = find(probe.at)!;
            const x = cx(n) + (probe.side === 'l' ? -1 : 1) * c.pitch * 0.34;
            const y = cy(n) + r + 9;
            const dx = x - cx(n);
            const dy = y - cy(n);
            const len = Math.hypot(dx, dy);
            return (
              <g data-probe={`${n.key}-${probe.side}`}>
                <line
                  x1={cx(n) + (dx / len) * r}
                  y1={cy(n) + (dy / len) * r}
                  x2={x}
                  y2={y}
                  style={{ stroke: 'var(--color-focus)' }}
                  strokeWidth="1.8"
                  strokeDasharray="3 3"
                />
                <rect
                  x={x - 13}
                  y={y}
                  width="26"
                  height="14"
                  rx="2"
                  style={{ fill: 'var(--color-surface)', stroke: 'var(--color-focus)' }}
                  strokeWidth="1.8"
                  strokeDasharray="3 2"
                />
                <text
                  x={x}
                  y={y + 10}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="600"
                  style={{ fill: 'var(--color-focus)' }}
                >
                  null
                </text>
              </g>
            );
          })()
        : null}
      {swap && find(swap[0]) && find(swap[1])
        ? (() => {
            const a = find(swap[0])!;
            const b = find(swap[1])!;
            const x1 = cx(a);
            const x2 = cx(b);
            const y = Math.min(cy(a), cy(b)) - r - 4;
            const mx = (x1 + x2) / 2;
            const top = y - c.levelH * 0.3;
            return (
              <g data-swap={`${a.key}-${b.key}`}>
                <path
                  d={`M ${x1} ${y} Q ${mx} ${top} ${x2} ${y}`}
                  fill="none"
                  style={{ stroke: 'var(--color-mark)' }}
                  strokeWidth="2"
                />
                {head(
                  x1,
                  y,
                  (Math.atan2(y - top, x1 - mx) * 180) / Math.PI,
                  'var(--color-mark)',
                  'sw1',
                )}
                {head(
                  x2,
                  y,
                  (Math.atan2(y - top, x2 - mx) * 180) / Math.PI,
                  'var(--color-mark)',
                  'sw2',
                )}
              </g>
            );
          })()
        : null}
      {turn === undefined
        ? null
        : (() => {
            // An arc about the middle of the edge, on its outer side — away
            // from the subtrees — from beside the child round to beside the
            // node: the way the child goes up and the node comes down.
            const p = find(turn.at)!;
            const q = (turn.dir === 'right' ? p.left : p.right)!;
            const mx = (cx(p) + cx(q)) / 2;
            const my = (cy(p) + cy(q)) / 2;
            const toQ = Math.atan2(cy(q) - my, cx(q) - mx);
            const radius = Math.hypot(cx(q) - cx(p), cy(q) - cy(p)) * 0.42;
            const gap = (42 * Math.PI) / 180;
            // Clockwise, in SVG's downward y, is the growing angle.
            const sign = turn.dir === 'right' ? 1 : -1;
            const from = toQ + sign * gap;
            const to = toQ + sign * (Math.PI - gap);
            const at = (a: number) => [mx + radius * Math.cos(a), my + radius * Math.sin(a)];
            const [x1, y1] = at(from);
            const [x2, y2] = at(to);
            const color = 'var(--color-accent)';
            return (
              <g data-turn={turn.dir} data-edge={`${p.key}-${q.key}`}>
                <path
                  d={`M ${x1} ${y1} A ${radius} ${radius} 0 0 ${turn.dir === 'right' ? 1 : 0} ${x2} ${y2}`}
                  fill="none"
                  style={{ stroke: color }}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                {head(x2!, y2!, ((to + (sign * Math.PI) / 2) * 180) / Math.PI, color, 'turn-h')}
              </g>
            );
          })()}
      {seek === undefined ? null : (
        <g>
          <rect
            x={offset + 4}
            y={4}
            width={String(seek).length * 8 + 92}
            height="24"
            rx="12"
            style={{ fill: 'var(--color-sunk)', stroke: 'var(--color-rule-strong)' }}
            strokeWidth="1.4"
          />
          <text
            x={offset + 16}
            y={20.5}
            fontSize="12.5"
            fontWeight="700"
            style={{ fill: 'var(--color-ink)' }}
          >{`se busca el ${seek}`}</text>
        </g>
      )}
      {visits ? seq.slice(1).map((b, i) => step(seq[i]!, b, `s${b.key}`)) : null}
      {shown.length === 0 && emptyNote ? (
        <text
          x={cx(root)}
          y={cy(root) + 5}
          textAnchor="middle"
          fontSize="13"
          fontFamily="var(--font-mono, monospace)"
          style={{ fill: 'var(--color-ink-soft)' }}
        >
          {emptyNote}
        </text>
      ) : null}
      {shown.map((n) => {
        const tone = toneOf(n) as Exclude<BinaryPictureTone, 'hidden'>;
        const [fill, stroke, weight] = TONE[tone];
        const faint = tone === 'faint';
        return (
          <g
            key={`n${n.key}`}
            data-node
            data-value={n.key}
            data-column={n.column}
            data-tone={tone}
            data-visit={rank.get(n)}
            data-subtree={isSubtree(n) ? '' : undefined}
            opacity={faint ? 0.5 : undefined}
          >
            {isSubtree(n) ? (
              // A whole subtree: apex where a node's top would be, base in
              // the room a level keeps under its nodes, as wide as its column.
              <path
                d={`M ${cx(n)} ${cy(n) - r} L ${cx(n) + c.pitch * 0.44} ${cy(n) + r + 6} L ${cx(n) - c.pitch * 0.44} ${cy(n) + r + 6} Z`}
                style={{ fill, stroke }}
                strokeWidth={weight}
                strokeLinejoin="round"
                strokeDasharray={faint ? '4 3' : undefined}
              />
            ) : (
              <circle
                cx={cx(n)}
                cy={cy(n)}
                r={r}
                style={{ fill, stroke }}
                strokeWidth={weight}
                strokeDasharray={faint ? '4 3' : undefined}
              />
            )}
            <text
              x={cx(n)}
              y={cy(n) + (isSubtree(n) ? 10 : 5)}
              textAnchor="middle"
              fontSize="14"
              fontWeight="600"
              style={{ fill: 'var(--color-ink)' }}
            >
              {n.value}
            </text>
            {badges[n.key] !== undefined ? (
              <text
                x={cx(n) + r - 1}
                y={cy(n) - r + 3}
                fontSize="10.5"
                fontWeight="700"
                paintOrder="stroke"
                strokeWidth="3"
                style={{ fill: 'var(--color-focus)', stroke: 'var(--color-ground)' }}
              >
                {badges[n.key]}
              </text>
            ) : null}
            {notes[n.key] !== undefined ? (
              <text
                x={cx(n)}
                y={cy(n) + r + 12}
                textAnchor="middle"
                fontSize="10"
                paintOrder="stroke"
                strokeWidth="3"
                style={{ fill: 'var(--color-ink-soft)', stroke: 'var(--color-ground)' }}
              >
                {notes[n.key]}
              </text>
            ) : null}
          </g>
        );
      })}
      {visits
        ? seq.map((n) => dot(cx(n) - r * 0.8, cy(n) - r * 0.8, rank.get(n)!, seqColor, `d${n.key}`))
        : null}
      {strip
        ? nodes.map((n) => (
            <g key={`s${n.key}`} data-slot data-value={n.key} data-column={n.column}>
              <line
                x1={cx(n)}
                y1={cy(n) + r + 3}
                x2={cx(n)}
                y2={c.stripY - 3}
                style={{ stroke: 'var(--color-rule)' }}
                strokeWidth="1"
                strokeDasharray="2 4"
              />
              <rect
                x={cx(n) - TREE_SLOT_W / 2}
                y={c.stripY}
                width={TREE_SLOT_W}
                height={TREE_SLOT_H}
                rx="3"
                style={{
                  fill: 'var(--color-surface)',
                  stroke: visits === 'in' ? seqColor : 'var(--color-rule-strong)',
                }}
                strokeWidth={visits === 'in' ? 1.6 : 1}
              />
              <text
                x={cx(n)}
                y={c.stripY + 20}
                textAnchor="middle"
                fontSize="14"
                fontWeight="600"
                style={{ fill: 'var(--color-ink)' }}
              >
                {n.value}
              </text>
            </g>
          ))
        : null}
      {splits
        ? [...nodes]
            .sort((a, b) => a.depth - b.depth || a.column - b.column)
            .map((n) => {
              // A subtree's columns are contiguous: from its leftmost node to
              // its rightmost, which is the stretch of the array it decides.
              let first = n;
              while (first.left) first = first.left;
              let last = n;
              while (last.right) last = last.right;
              const tone = splitTone(n.depth);
              const stroke = TONE[tone][1];
              const y = c.splitRowY(n.depth);
              const span = nodes.slice(first.column, last.column + 1);
              return (
                <g
                  key={`p${n.key}`}
                  data-split
                  data-value={n.key}
                  data-depth={n.depth}
                  data-from={first.column}
                  data-to={last.column}
                  data-tone={tone}
                >
                  {/* A stretch of one value is only its middle: no box around the box. */}
                  {first !== last ? (
                    <rect
                      x={cx(first) - c.pitch / 2 + 2}
                      y={y}
                      width={cx(last) - cx(first) + c.pitch - 4}
                      height={TREE_SLOT_H}
                      rx="6"
                      style={{ fill: 'var(--color-surface)', stroke }}
                      strokeWidth="1.4"
                    />
                  ) : null}
                  {span.map((m) =>
                    m === n ? (
                      <g key={m.key}>
                        <rect
                          x={cx(m) - TREE_SLOT_W / 2}
                          y={y + 2}
                          width={TREE_SLOT_W}
                          height={TREE_SLOT_H - 4}
                          rx="3"
                          style={{ fill: SPLIT_SOFT[tone], stroke }}
                          strokeWidth="2"
                        />
                        <text
                          x={cx(m)}
                          y={y + 20}
                          textAnchor="middle"
                          fontSize="14"
                          fontWeight="700"
                          style={{ fill: 'var(--color-ink)' }}
                        >
                          {m.value}
                        </text>
                      </g>
                    ) : (
                      <text
                        key={m.key}
                        x={cx(m)}
                        y={y + 20}
                        textAnchor="middle"
                        fontSize="13"
                        style={{ fill: 'var(--color-ink-soft)' }}
                      >
                        {m.value}
                      </text>
                    ),
                  )}
                </g>
              );
            })
        : null}
      {sequence
        ? (() => {
            let x = (c.width - sequenceWidth(seq.map((n) => n.value))) / 2;
            return seq.map((n, i) => {
              const w = chipWidth(n.value);
              const x0 = x + (i > 0 ? CHIP_GAP : 0);
              x = x0 + w;
              return (
                <g key={`c${n.key}`} data-chip data-value={n.key}>
                  {i > 0 ? (
                    <line
                      x1={x0 - CHIP_GAP + 3}
                      y1={c.sequenceY + 14}
                      x2={x0 - 6}
                      y2={c.sequenceY + 14}
                      style={{ stroke: seqColor }}
                      strokeWidth="1.6"
                    />
                  ) : null}
                  {i > 0 ? head(x0 - 2, c.sequenceY + 14, 0, seqColor, `ch${n.key}`) : null}
                  <rect
                    x={x0}
                    y={c.sequenceY}
                    width={w}
                    height="28"
                    rx="14"
                    style={{ fill: 'var(--color-surface)', stroke: seqColor }}
                    strokeWidth="1.6"
                  />
                  {dot(x0 + 13, c.sequenceY + 14, i + 1, seqColor, `cd${n.key}`)}
                  <text
                    x={x0 + 26 + (w - 26) / 2}
                    y={c.sequenceY + 19}
                    textAnchor="middle"
                    fontSize="14"
                    fontWeight="600"
                    style={{ fill: 'var(--color-ink)' }}
                  >
                    {n.value}
                  </text>
                </g>
              );
            });
          })()
        : null}
      {caption ? (
        <text
          x={c.width / 2}
          y={c.fullHeight + 12}
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
