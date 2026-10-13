import { AuthoringError } from '../AuthoringError';
import { TREE_NODE_R } from '../treeGeometry';

/** A node of the drawing: its value, and its place on the grid in columns and rows. */
export interface NodeGraphNode {
  v: number | string;
  /** Column, from 0; a half places it between two columns. */
  x: number;
  /** Row, from 0 at the top. */
  y: number;
}

/** An edge, from one node's value to another's. */
export type NodeGraphEdge = [number | string, number | string];

export interface NodeGraphProps {
  nodes: NodeGraphNode[];
  edges: NodeGraphEdge[];
  /** How many columns the grid has. */
  cols: number;
  /** How many rows the grid has. */
  rows: number;
  /** `mark` on the node that breaks the rule the drawing shows, keyed by value. */
  tones?: Record<string, 'mark'>;
  /** The edges that break it, painted in mark too. */
  markEdges?: NodeGraphEdge[];
  caption?: string;
  /** What the figure shows, in Spanish: its accessible name. Required. */
  label: string;
}

const PITCH = 52;
const LEVEL_H = 58;
const PAD = 18;

/**
 * Nodes at explicit grid positions, joined by edges: for a shape no tree
 * layout can draw — a node with three children, a node with two parents —
 * which is what a counterexample to a tree's invariants looks like. The nodes
 * are `<BinaryPicture>`'s circles; a node or an edge in `mark` is the one that
 * breaks the rule.
 *
 * Promoted from a figure local to Árboles I when Árboles II became the second
 * document to want it (#322, `add-a-course-document.md` §6e-quater).
 */
export function NodeGraph(props: NodeGraphProps) {
  const { nodes, edges, markEdges = [], label } = props;
  if (label === undefined || label === '') {
    return (
      <AuthoringError component="NodeGraph">
        necesita un label que describa el dibujo, en español.
      </AuthoringError>
    );
  }
  const known = new Set(nodes.map((n) => String(n.v)));
  const stray = [...edges, ...markEdges].flat().find((v) => !known.has(String(v)));
  if (stray !== undefined) {
    return (
      <AuthoringError component="NodeGraph">
        tiene una arista que llega a {String(stray)}, que no está entre los nodos.
      </AuthoringError>
    );
  }
  return <Graph {...props} />;
}

function Graph({
  nodes,
  edges,
  cols,
  rows,
  tones = {},
  markEdges = [],
  caption,
  label,
}: NodeGraphProps) {
  const r = TREE_NODE_R;
  const drawingW = 2 * PAD + cols * PITCH;
  const width = Math.max(drawingW, caption ? caption.length * 6.6 + 24 : 0);
  const offset = (width - drawingW) / 2;
  const treeH = 2 * PAD + 2 * r + (rows - 1) * LEVEL_H;
  const height = treeH + (caption ? 20 : 0);
  const at = new Map(
    nodes.map((n) => [
      String(n.v),
      { x: offset + PAD + (n.x + 0.5) * PITCH, y: PAD + r + n.y * LEVEL_H },
    ]),
  );
  const marked = new Set(markEdges.map(([a, b]) => `${a}>${b}`));
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: '100%',
        maxWidth: `${Math.round(width * 1.4)}px`,
        height: 'auto',
        display: 'block',
        margin: '1rem auto',
      }}
      role="img"
      aria-label={label}
    >
      {edges.map(([a, b]) => {
        const p = at.get(String(a))!;
        const c = at.get(String(b))!;
        const dx = c.x - p.x;
        const dy = c.y - p.y;
        const len = Math.hypot(dx, dy);
        const hot = marked.has(`${a}>${b}`);
        return (
          <line
            key={`${a}>${b}`}
            data-edge={`${a}>${b}`}
            data-marked={hot ? '' : undefined}
            x1={p.x + (dx / len) * r}
            y1={p.y + (dy / len) * r}
            x2={c.x - (dx / len) * r}
            y2={c.y - (dy / len) * r}
            style={{ stroke: hot ? 'var(--color-mark)' : 'var(--color-rule-strong)' }}
            strokeWidth={hot ? 2.6 : 1.3}
          />
        );
      })}
      {nodes.map((n) => {
        const hot = tones[String(n.v)] === 'mark';
        const { x, y } = at.get(String(n.v))!;
        return (
          <g key={`n${n.v}`} data-node data-value={n.v} data-tone={hot ? 'mark' : 'idle'}>
            <circle
              cx={x}
              cy={y}
              r={r}
              style={{
                fill: hot ? 'var(--color-mark-soft)' : 'var(--color-surface)',
                stroke: hot ? 'var(--color-mark)' : 'var(--color-rule-strong)',
              }}
              strokeWidth={hot ? 2.2 : 1.3}
            />
            <text
              x={x}
              y={y + 5}
              textAnchor="middle"
              fontSize="14"
              fontWeight="600"
              style={{ fill: 'var(--color-ink)' }}
            >
              {n.v}
            </text>
          </g>
        );
      })}
      {caption ? (
        <text
          x={width / 2}
          y={treeH + 12}
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
