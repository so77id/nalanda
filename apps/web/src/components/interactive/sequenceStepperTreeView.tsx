import { CELL_FILL, CELL_NOTE, CELL_STROKE } from './sequenceStepperPaint';
import type { TreeFrame, TreeRun } from './sequenceStepperTrace';
import {
  TREE_NODE_R,
  layoutTree,
  treeEdge,
  treeProbe,
  type TreeProbe,
} from './sequenceStepperTreeLayout';

// ── the tree: every node in the column of its inorder position (#321) ─────

/**
 * The tree recipe draws the linked tree with each node in a column fixed for
 * the whole run — its inorder position — and on the row of its depth, and a
 * strip under it with one slot per column. A traversal writes its output into
 * the strip left to right, so the inorder lands under its own nodes and the
 * other two orders visibly do not.
 *
 * The calls still open are the lit edges from the root down to the node under
 * the algorithm's eye; the number beside a node is its visit order, so the
 * order reads without the colours.
 */
export function TreeView({
  tree,
  run,
  description,
  label,
  presentation,
}: {
  /** What this frame leaves. */
  tree: TreeFrame;
  /** What the whole run needs, so the canvas keeps one size. */
  run: TreeRun;
  /** The frame's narration, repeated in the accessible name. */
  description: string;
  label: string;
  presentation: boolean;
}) {
  const layout = layoutTree(run.slots, run.depth, run.strip);
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const at = (id: number) => {
    const n = byId.get(id)!;
    return layout.node(run.columns[id]!, n.depth);
  };
  const hot = new Set(tree.path.slice(1).map((id, i) => `${tree.path[i]}-${id}`));
  const written = tree.strip.filter((v) => v !== null);
  const kind = label.charAt(0).toUpperCase() + label.slice(1);
  // Empty only in the search tree of #322, which starts with no root.
  const root = tree.root === null ? undefined : byId.get(tree.root);
  const count = tree.nodes.length;
  const summary = `${kind} ${
    root === undefined
      ? 'vacío'
      : `con raíz ${root.value} y ${count} ${count === 1 ? 'nodo' : 'nodos'}`
  }.${written.length > 0 ? ` En la tira: ${written.join(', ')}.` : ''} ${description}`;

  // On a slide the drawing gets a fixed share of the stage. The cap goes on
  // the svg itself, in absolute terms: a percentage max-height resolves
  // against the container's HEIGHT, and a box with only a max-height has
  // none, so `100%` capped nothing and a tree of four levels or more scrolled
  // its panel (#322, measured in the deck). The 1.5rem is the panel's padding.
  const cap = 'min(46vh, 440px)';
  return (
    <div
      className="flex items-center justify-center overflow-x-auto p-3"
      style={{ maxHeight: presentation ? cap : undefined }}
    >
      <svg
        data-testid="tree-view"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-auto w-full"
        style={{
          maxWidth: `${layout.width * 1.6}px`,
          maxHeight: presentation ? `calc(${cap} - 1.5rem)` : undefined,
        }}
        role="img"
        aria-label={summary}
      >
        {tree.nodes.map((n) =>
          [n.left, n.right].map((child) => {
            if (child === null) return null;
            const e = treeEdge(at(n.id), at(child));
            const lit = hot.has(`${n.id}-${child}`);
            // An edge into a subtree the search ruled out fades with it (#322).
            const target = byId.get(child)!;
            const out = target.state === 'discarded';
            const stroke = lit
              ? 'var(--color-focus)'
              : out
                ? 'var(--color-rule)'
                : 'var(--color-rule-strong)';
            // A reference whose node is not below its holder — `q.right = p`
            // mid-rotation — would read as an ordinary child the other way
            // round, so it carries an arrowhead at the node it points at.
            const up = target.depth <= n.depth;
            return (
              <g
                key={`${n.id}-${child}`}
                data-edge-up={up ? `${n.value}-${target.value}` : undefined}
              >
                <line
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke={stroke}
                  strokeWidth={lit ? 2.6 : 1.2}
                  strokeDasharray={out ? '4 3' : undefined}
                />
                {up ? (
                  <Arrowhead x={e.x2} y={e.y2} from={{ x: e.x1, y: e.y1 }} color={stroke} />
                ) : null}
              </g>
            );
          }),
        )}
        {tree.probe === undefined ? null : (
          <EmptyCall
            probe={treeProbe(at(tree.probe.parent), tree.probe.side)}
            side={tree.probe.side}
          />
        )}
        {tree.nodes.map((n) => {
          const { cx, cy } = at(n.id);
          const strong = n.state !== 'idle' && n.state !== 'visited' && n.state !== 'discarded';
          const out = n.state === 'discarded';
          return (
            <g
              key={n.id}
              data-node
              data-value={n.value}
              data-column={run.columns[n.id]}
              data-state={n.state}
              // Ruled out by the invariant: faded and dashed, so the colour is
              // not the only signal.
              opacity={out ? 0.45 : undefined}
            >
              <circle
                cx={cx}
                cy={cy}
                r={TREE_NODE_R}
                fill={CELL_FILL[n.state]}
                stroke={CELL_STROKE[n.state]}
                strokeWidth={strong ? 2.4 : 1.2}
                strokeDasharray={out ? '4 3' : undefined}
              />
              {n.state === 'found' || n.state === 'leaving' ? (
                <text
                  x={cx}
                  y={cy + TREE_NODE_R + 12}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--color-ink-soft)"
                >
                  {CELL_NOTE[n.state]}
                </text>
              ) : null}
              <text
                x={cx}
                y={cy + 5}
                textAnchor="middle"
                fontSize="14"
                fontWeight="600"
                fill="var(--color-ink)"
              >
                {n.value}
              </text>
              {n.badge === undefined ? null : (
                // A left child's badge sits on the edge arriving from its
                // parent; the halo in the panel's own colour keeps it legible.
                <text
                  x={cx + TREE_NODE_R - 1}
                  y={cy - TREE_NODE_R + 3}
                  textAnchor="start"
                  fontSize="10"
                  fontWeight="700"
                  fill="var(--color-focus)"
                  stroke="var(--color-surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {n.badge}
                </text>
              )}
            </g>
          );
        })}
        {layout.strip.map((slot, k) => {
          const value = tree.strip[k] ?? null;
          const fresh = tree.stripFresh === k;
          return (
            <g key={`slot${k}`} data-slot={k} data-value={value ?? undefined}>
              <rect
                x={slot.cx - slot.w / 2}
                y={slot.y}
                width={slot.w}
                height={slot.h}
                rx={3}
                fill={fresh ? 'var(--color-mark-soft)' : 'var(--color-surface)'}
                stroke={
                  fresh
                    ? 'var(--color-mark)'
                    : value === null
                      ? 'var(--color-rule)'
                      : 'var(--color-rule-strong)'
                }
                strokeWidth={fresh ? 2.2 : 1}
                strokeDasharray={value === null ? '3 3' : undefined}
              />
              {value === null ? null : (
                <text
                  x={slot.cx}
                  y={slot.y + slot.h / 2 + 5}
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="600"
                  fill="var(--color-ink)"
                >
                  {value}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A small filled head at the end of a reference, pointing the way it runs. */
function Arrowhead({
  x,
  y,
  from,
  color,
}: {
  x: number;
  y: number;
  from: { x: number; y: number };
  color: string;
}) {
  const angle = (Math.atan2(y - from.y, x - from.x) * 180) / Math.PI;
  return (
    <polygon
      points="0,0 -8,-4.5 -8,4.5"
      transform={`translate(${x} ${y}) rotate(${angle})`}
      fill={color}
    />
  );
}

/**
 * The empty subtree a call just landed on — the base case — drawn for the one
 * frame that call runs: a dashed line out of the parent and a dashed box, in
 * the colour of the call under the eye, with `null` written in it so the
 * colour is not the only signal.
 */
function EmptyCall({ probe, side }: { probe: TreeProbe; side: 'left' | 'right' }) {
  const { line, box } = probe;
  return (
    <g data-probe={side}>
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        stroke="var(--color-focus)"
        strokeWidth={1.8}
        strokeDasharray="3 3"
      />
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={2}
        fill="var(--color-surface)"
        stroke="var(--color-focus)"
        strokeWidth={1.8}
        strokeDasharray="3 2"
      />
      <text
        x={box.x + box.w / 2}
        y={box.y + box.h - 4}
        textAnchor="middle"
        fontSize="9"
        fontWeight="600"
        fill="var(--color-focus)"
      >
        null
      </text>
    </g>
  );
}
