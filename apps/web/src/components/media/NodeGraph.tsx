import { AuthoringError } from '../AuthoringError';
import {
  NODE_R,
  STEP_R,
  STEP_SPACE,
  layoutNodeGraph,
  stepMarks,
  walkStrokes,
  type NodeGraphEdge,
  type NodeGraphNode,
} from '../nodeGraphLayout';

export type { NodeGraphEdge, NodeGraphNode } from '../nodeGraphLayout';

/** What a tone says: `mark` look here, `flag` this is wrong, `keep` this is done. */
export type NodeGraphTone = 'mark' | 'flag' | 'keep';

export interface NodeGraphProps {
  nodes: NodeGraphNode[];
  /** `[from, to]`, or `[from, to, weight]` to write a weight on the edge. */
  edges: NodeGraphEdge[];
  /** How many columns the grid has. */
  cols: number;
  /** How many rows the grid has. */
  rows: number;
  /** Arrows: every edge goes from its first node to its second. */
  directed?: boolean;
  /** A tone on a node, keyed by value. */
  tones?: Record<string, NodeGraphTone>;
  /** Edges painted thicker in mark; in an undirected graph, either order matches. */
  markEdges?: NodeGraphEdge[];
  /**
   * Edges of `edges` drawn dashed in flag: a link that was there and is not
   * any more — a cut cable. Either order matches in an undirected graph.
   */
  cutEdges?: NodeGraphEdge[];
  /**
   * A walk, as the vertices it visits in order: its edges are marked and each
   * carries the number of its step, as `<PenTrace>` numbers a tracing.
   * Parallel edges are walked in turn.
   */
  walk?: (string | number)[];
  /** A short note beside a node, keyed by value: its degree, for instance. */
  notes?: Record<string, string | number>;
  caption?: string;
  /**
   * How far the drawing may grow over its natural width. Default 1.4; a
   * widget that draws the graph beside other panels on a slide raises it.
   */
  maxScale?: number;
  /** What the figure shows, in Spanish: its accessible name. Required. */
  label: string;
}

type Paint = NodeGraphTone | 'idle';

const FILL: Record<Paint, string> = {
  idle: 'var(--color-surface)',
  mark: 'var(--color-mark-soft)',
  flag: 'var(--color-flag-soft)',
  keep: 'var(--color-keep-soft)',
};
const STROKE: Record<Paint, string> = {
  idle: 'var(--color-rule-strong)',
  mark: 'var(--color-mark)',
  flag: 'var(--color-flag)',
  keep: 'var(--color-keep)',
};

/**
 * A graph drawn at explicit grid positions: vertices joined by edges, with
 * arrows when it is directed, a weight on an edge, a note beside a vertex.
 * Also the shape no tree layout can draw — a node with three children, a node
 * with two parents — which is what a counterexample to a tree's invariants
 * looks like.
 *
 * Promoted from a figure local to Árboles I when Árboles II became the second
 * document to want it (#322, `add-a-course-document.md` §6e-quater); #356 gave
 * it what the Grafos unit draws: arrows, weights, edges between the same two
 * vertices, notes, names in pills, and the `flag` and `keep` tones. Its
 * geometry is the pure `nodeGraphLayout.ts`.
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
  const stray = [...edges, ...markEdges]
    .flatMap((e) => [e[0], e[1]])
    .find((v) => !known.has(String(v)));
  if (stray !== undefined) {
    return (
      <AuthoringError component="NodeGraph">
        tiene una arista que llega a {String(stray)}, que no está entre los nodos.
      </AuthoringError>
    );
  }
  if (props.walk && walkStrokes(edges, props.walk, props.directed ?? false) === null) {
    return (
      <AuthoringError component="NodeGraph">
        tiene un recorrido que da un paso por donde no hay arista.
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
  directed = false,
  tones = {},
  markEdges = [],
  cutEdges = [],
  walk = [],
  notes = {},
  caption,
  maxScale = 1.4,
  label,
}: NodeGraphProps) {
  const r = NODE_R;
  const layout = layoutNodeGraph({
    nodes,
    edges,
    cols,
    rows,
    directed,
    captionChars: caption ? caption.length : 0,
    noted: Object.keys(notes),
  });
  const { width, drawingH, at, halfW, noteAt } = layout;
  const height = drawingH + (caption ? 20 : 0);
  const marked = new Set(
    markEdges.flatMap(([a, b]) => (directed ? [`${a}>${b}`] : [`${a}>${b}`, `${b}>${a}`])),
  );
  const cut = new Set(
    cutEdges.flatMap(([a, b]) => (directed ? [`${a}>${b}`] : [`${a}>${b}`, `${b}>${a}`])),
  );
  const walked = walkStrokes(edges, walk, directed) ?? [];
  const steps = stepMarks(layout, { path: walk.map(String), used: walked }, STEP_SPACE);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: '100%',
        maxWidth: `${Math.round(width * maxScale)}px`,
        height: 'auto',
        display: 'block',
        margin: '1rem auto',
      }}
      role="img"
      aria-label={label}
    >
      {layout.edges.map((e, i) => {
        const hot = marked.has(e.key) || walked.includes(i);
        const gone = cut.has(e.key);
        const color = gone
          ? 'var(--color-flag)'
          : hot
            ? 'var(--color-mark)'
            : 'var(--color-rule-strong)';
        return (
          <g
            key={`${e.key}#${i}`}
            data-edge={e.key}
            data-marked={hot ? '' : undefined}
            data-cut={gone ? '' : undefined}
          >
            <path
              d={e.d}
              fill="none"
              style={{ stroke: color }}
              strokeWidth={hot || gone ? 2.6 : 1.3}
              strokeDasharray={gone ? '6 5' : undefined}
            />
            {e.arrow ? <polygon points={e.arrow} style={{ fill: color }} /> : null}
          </g>
        );
      })}
      {layout.edges.map((e, i) =>
        e.weight !== undefined && e.weightAt ? (
          <WeightChip key={`w${e.key}#${i}`} text={e.weight} x={e.weightAt.x} y={e.weightAt.y} />
        ) : null,
      )}
      {steps.map(({ stroke, step, x, y }) => (
        <g key={`step${stroke}`} data-step={step} data-of={stroke}>
          <circle
            cx={x}
            cy={y}
            r={STEP_R}
            style={{ fill: 'var(--color-surface)', stroke: 'var(--color-mark)' }}
            strokeWidth={1.6}
          />
          <text
            x={x}
            y={y + 3.5}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            style={{ fill: 'var(--color-ink)' }}
          >
            {step}
          </text>
        </g>
      ))}
      {nodes.map((n) => {
        const value = String(n.v);
        const tone = (tones[value] as NodeGraphTone | undefined) ?? 'idle';
        const hot = tone !== 'idle';
        const { x, y } = at.get(value)!;
        const hw = halfW.get(value)!;
        const note = notes[value];
        const shape = hw > r ? 'pill' : 'circle';
        const paint = {
          style: { fill: FILL[tone], stroke: STROKE[tone] },
          strokeWidth: hot ? 2.2 : 1.3,
        };
        return (
          <g key={`n${value}`} data-node data-value={n.v} data-tone={tone} data-shape={shape}>
            {shape === 'circle' ? (
              <circle cx={x} cy={y} r={r} {...paint} />
            ) : (
              <rect x={x - hw} y={y - r} width={2 * hw} height={2 * r} rx={r} {...paint} />
            )}
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
            {note !== undefined ? (
              <text
                data-note={note}
                x={noteAt.get(value)!.x}
                y={noteAt.get(value)!.y + 4.5}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                style={{ fill: hot ? STROKE[tone] : 'var(--color-ink-soft)' }}
              >
                {note}
              </text>
            ) : null}
          </g>
        );
      })}
      {caption ? (
        <text
          x={width / 2}
          y={drawingH + 12}
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

/**
 * An edge's weight, centred on the line with no box: a halo in the page's
 * ground colour hides the line behind the digits.
 */
function WeightChip({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <g data-weight={text}>
      <text
        x={x}
        y={y + 4.5}
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        style={{ fill: 'var(--color-ink)' }}
        stroke="var(--color-ground)"
        strokeWidth={5}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {text}
      </text>
    </g>
  );
}
