import { useMemo } from 'react';
import { useMode } from '../../presentation';
import { AuthoringError } from '../AuthoringError';
import {
  NodeGraph,
  type NodeGraphEdge,
  type NodeGraphNode,
  type NodeGraphTone,
} from '../media/NodeGraph';
import {
  adjacencyOf,
  traceDfs,
  traceDfsStack,
  type GraphWalkEdge,
  type WalkEvent,
  type WalkFrame,
} from './graphWalkTrace';
import { Step } from './Step';
import { StepShow } from './StepShow';

export type GraphWalkAlgorithm = 'dfs' | 'dfs-iterative' | 'dfs-mark-on-push';

/** The events of each walk, each lighting the lines an author maps it to. */
const EVENTS: Record<GraphWalkAlgorithm, readonly WalkEvent[]> = {
  dfs: ['mark', 'look', 'prev', 'recurse', 'return'],
  'dfs-iterative': ['pushStart', 'pop', 'skip', 'mark', 'look', 'prev', 'push', 'end'],
  'dfs-mark-on-push': ['markStart', 'pushStart', 'pop', 'look', 'mark', 'prev', 'push', 'end'],
};

export interface GraphWalkProps {
  /**
   * The walk to simulate: `dfs`, the recursive depth-first search (the
   * default); `dfs-iterative`, the same search with a stack of its own that
   * marks on pop; `dfs-mark-on-push`, the tempting version that marks on push
   * and does not walk depth first (#357 S5).
   */
  algorithm?: GraphWalkAlgorithm;
  /** The vertices, numbered 0..V−1, each at a grid position (as `<NodeGraph>`). */
  nodes: NodeGraphNode[];
  /** `[v, w]`, in the order the program adds them: that order is `adj`'s. */
  edges: [number, number][];
  /** How many columns the drawing's grid has. */
  cols: number;
  /** How many rows the drawing's grid has. */
  rows: number;
  /** Arcs instead of edges. */
  directed?: boolean;
  /** The vertex the walk starts from. Default the first node. */
  start?: number;
  /**
   * The lines each event lights, in the listing's own numbering — the FILE's
   * when the listing comes from `codeSrc` (ADR-0091). For `dfs`: `mark`
   * (`marked[v] = true`), `look` (the `for` and its `if`), `prev`
   * (`prev[w] = v`), `recurse` (the call) and `return` (the method's end).
   * For `dfs-iterative`: `pushStart` (the stack and its first push), `pop`,
   * `skip` (the `if (marked[v]) continue`), `mark`, `look`, `prev`, `push`
   * and `end` (the loop's test, failing). For `dfs-mark-on-push`: the same
   * without `skip`, plus `markStart` (`marked[s] = true`).
   */
  lines: Partial<Record<WalkEvent, number | number[]>>;
  /** The listing, written in the document. Or `codeSrc`. */
  code?: string;
  /** The file the listing quotes, relative to the document (ADR-0091). */
  codeSrc?: string;
  codeRange?: string;
  /** The badge over the listing: `DepthFirstPaths.java`. */
  codeName?: string;
  /** The program that calls the walk, shown over the listing. Or `programSrc`. */
  program?: string;
  programSrc?: string;
  programRange?: string;
  programName?: string;
  /** The program's lines lit in every frame: the call the walk is inside. */
  programLines?: number[];
  /** On a slide, the drawing beside the listing (`<StepShow beside>`). */
  beside?: boolean;
  /** With `beside`, the "code/drawing" split. */
  ratio?: string;
  title?: string;
  /** What the graph is, in Spanish; each frame's drawing adds what it shows. */
  label: string;
}

/**
 * A walk over a graph, simulated and played by `<StepShow>` (ADR-0092): the
 * frames come from `graphWalkTrace.ts`, so they cannot disagree with the
 * algorithm, and the listing stays in the document's files. Each frame draws
 * the graph — the running call in mark, the finished ones in keep, the thread
 * of calls in progress as marked edges — over the call stack and the arrays.
 */
export function GraphWalk(props: GraphWalkProps) {
  const { nodes, edges, lines, code, codeSrc } = props;
  const algorithm = props.algorithm ?? 'dfs';
  if (!Object.hasOwn(EVENTS, algorithm)) {
    return (
      <AuthoringError component="GraphWalk">
        algorithm=&quot;{String(algorithm)}&quot; no existe; son dfs, dfs-iterative y
        dfs-mark-on-push.
      </AuthoringError>
    );
  }
  const V = nodes.length;
  const ids = nodes.map((n) => n.v);
  if (ids.some((v, i) => v !== i)) {
    return (
      <AuthoringError component="GraphWalk">
        los vértices de nodes tienen que ser 0, 1, …, {V - 1} en ese orden (llegaron{' '}
        {ids.join(', ')}): el recorrido los guarda en arreglos indexados por vértice.
      </AuthoringError>
    );
  }
  const bad = edges.find(([v, w]) => !inRange(V, v) || !inRange(V, w));
  if (bad) {
    return (
      <AuthoringError component="GraphWalk">
        la arista {bad[0]}-{bad[1]} nombra un vértice que no está en nodes.
      </AuthoringError>
    );
  }
  const start = props.start ?? 0;
  if (!inRange(V, start)) {
    return (
      <AuthoringError component="GraphWalk">
        start={start} no es un vértice de nodes.
      </AuthoringError>
    );
  }
  const missing = EVENTS[algorithm].filter((e) => lines[e] === undefined);
  if (missing.length > 0) {
    return (
      <AuthoringError component="GraphWalk">
        faltan en lines las líneas de {missing.join(', ')}: cada paso del recorrido ilumina la línea
        que lo hace.
      </AuthoringError>
    );
  }
  if (code === undefined && codeSrc === undefined) {
    return (
      <AuthoringError component="GraphWalk">
        falta el listado: escribe code o codeSrc con el método que se recorre.
      </AuthoringError>
    );
  }
  return <Body {...props} algorithm={algorithm} start={start} />;
}

function Body(props: GraphWalkProps & { algorithm: GraphWalkAlgorithm; start: number }) {
  const {
    algorithm,
    nodes,
    edges,
    cols,
    rows,
    directed = false,
    start,
    lines,
    label,
    programLines,
  } = props;
  const V = nodes.length;
  // MDX re-mints inline literals on every render: memoise on a primitive key
  // (add-a-content-component.md, the stepper rule).
  const edgesKey = edges.map(([v, w]) => `${v}-${w}`).join(',');
  const frames = useMemo(() => {
    const parsed: GraphWalkEdge[] = edgesKey === '' ? [] : edgesKey.split(',').map(parseEdge);
    const adj = adjacencyOf(V, parsed, directed);
    if (algorithm === 'dfs') return traceDfs(adj, start);
    return traceDfsStack(adj, start, algorithm === 'dfs-iterative' ? 'pop' : 'push');
  }, [algorithm, V, edgesKey, directed, start]);
  const depth = Math.max(...frames.map((f) => f.stack.length));

  return (
    <StepShow
      code={props.code}
      codeSrc={props.codeSrc}
      codeRange={props.codeRange}
      // A named listing is what lets `<StepShow>` show `under`; a file names
      // itself, an inline listing is named after the method it holds.
      codeName={props.codeName ?? (props.codeSrc === undefined ? 'dfs' : undefined)}
      program={props.program}
      programSrc={props.programSrc}
      programRange={props.programRange}
      programName={props.programName}
      beside={props.beside}
      ratio={props.ratio}
      title={props.title}
      language="java"
    >
      {frames.map((frame, i) => (
        // `marked` and `prev` are the program's own variables, passed to the
        // walk: they go under the listings, where `<StepShow>` shows what the
        // program holds (#363), and leave the drawing the graph and the stack.
        <Step
          key={i}
          lines={asLines(lines[frame.event])}
          programLines={programLines}
          under={<ArraysPanel frame={frame} />}
        >
          <Frame
            frame={frame}
            nodes={nodes}
            edges={edges}
            cols={cols}
            rows={rows}
            directed={directed}
            recursive={algorithm === 'dfs'}
            depth={depth}
            label={label}
          />
        </Step>
      ))}
    </StepShow>
  );
}

interface FrameProps {
  frame: WalkFrame;
  nodes: NodeGraphNode[];
  edges: [number, number][];
  cols: number;
  rows: number;
  directed: boolean;
  /** The recursive walk draws its call stack; an iterative one, its own stack. */
  recursive: boolean;
  depth: number;
  label: string;
}

function Frame({ frame, nodes, edges, cols, rows, directed, recursive, depth, label }: FrameProps) {
  // On a slide the drawing has its own column (`beside`) and the code is set
  // large: the graph takes more of it. Both caps are fixed numbers, never a
  // share of the column, so the frame's height never follows its width.
  const onSlide = useMode() === 'presentation';
  const tones: Record<string, NodeGraphTone> = {};
  // Recursive: the calls that returned are kept. Iterative: the vertices the
  // walk has reached.
  for (const v of recursive ? frame.done : frame.order) tones[String(v)] = 'keep';
  if (frame.v !== null) tones[String(frame.v)] = 'mark';
  if (frame.wrote?.array === 'marked') tones[String(frame.wrote.index)] = 'mark';
  // Marking on push: a neighbour skipped though the walk never reached it.
  if (frame.unvisited && frame.w !== null) tones[String(frame.w)] = 'flag';
  const thread = recursive
    ? // The edge each call in progress was entered by.
      frame.stack.slice(1).map((v): NodeGraphEdge => [frame.prev[v], v])
    : threadBack(frame);
  const looking: NodeGraphEdge[] = frame.v === null || frame.w === null ? [] : [[frame.v, frame.w]];
  return (
    <div
      className="flex flex-col items-center gap-1"
      data-testid="graph-walk-frame"
      data-event={frame.event}
      data-v={frame.v ?? ''}
      data-w={frame.w ?? ''}
    >
      <div style={{ fontSize: '0.9rem', textAlign: 'center', lineHeight: 1.4, minHeight: '2.8em' }}>
        {frame.text}
      </div>
      <div className="flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {/* Capped so the frame's height never depends on the panel's width:
            a drawing that grows with it makes the deck re-scale for ever. */}
        <div style={{ flex: '1 1 220px', maxWidth: onSlide ? '440px' : '320px' }}>
          <NodeGraph
            nodes={nodes}
            edges={edges}
            cols={cols}
            rows={rows}
            directed={directed}
            tones={tones}
            markEdges={[...thread, ...looking]}
            label={`${label} ${frame.text}`}
          />
        </div>
        {recursive ? (
          <StackPanel
            title="pila de llamadas"
            items={frame.stack.map((v) => `dfs(${v})`)}
            hot={frame.stack.length - 1}
            depth={depth}
            label={`Pila de llamadas: ${frame.stack.map((v) => `dfs(${v})`).join(', ')}; corre dfs(${frame.v}).`}
          />
        ) : (
          <StackPanel
            title="pila"
            items={frame.stack.map(String)}
            // The cell just pushed; a pop leaves nothing to light.
            hot={
              frame.event === 'push' || frame.event === 'pushStart' ? frame.stack.length - 1 : -1
            }
            depth={depth}
            label={
              frame.stack.length === 0
                ? 'La pila está vacía.'
                : `Pila, del fondo al tope: ${frame.stack.join(', ')}.`
            }
          />
        )}
      </div>
    </div>
  );
}

/**
 * The thread of an iterative walk: from the vertex it is on, back along
 * `prev` to the start — the way the recursive walk's calls in progress hold.
 */
function threadBack(frame: WalkFrame): NodeGraphEdge[] {
  const out: NodeGraphEdge[] = [];
  if (frame.v === null) return out;
  let x = frame.v;
  // A walk of V vertices has at most V − 1 steps back; the bound is a guard.
  for (let i = 0; i < frame.prev.length && frame.prev[x] >= 0; i++) {
    out.push([frame.prev[x], x]);
    x = frame.prev[x];
  }
  return out;
}

const CELL_H = 26;
const STACK_W = 92;

interface StackPanelProps {
  title: string;
  /** The cells, the bottom first. */
  items: string[];
  /** The cell in mark, or −1. */
  hot: number;
  /** The most cells the walk ever holds: the panel keeps that height. */
  depth: number;
  label: string;
}

/** A stack drawn bottom up: the calls in progress, or the walk's own stack. */
function StackPanel({ title, items, hot, depth, label }: StackPanelProps) {
  const head = 18;
  const height = head + depth * (CELL_H + 4) + 4;
  return (
    <svg
      viewBox={`0 0 ${STACK_W} ${height}`}
      style={{ width: `${STACK_W}px`, maxWidth: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={label}
    >
      <text
        x={STACK_W / 2}
        y={12}
        textAnchor="middle"
        fontSize="11"
        style={{ fill: 'var(--color-ink-soft)' }}
      >
        {title}
      </text>
      {items.map((text, i) => {
        const y = height - 4 - (i + 1) * (CELL_H + 4) + 4;
        const on = i === hot;
        return (
          <g key={i}>
            <rect
              x={4}
              y={y}
              width={STACK_W - 8}
              height={CELL_H}
              rx={4}
              style={{
                fill: on ? 'var(--color-mark-soft)' : 'var(--color-surface)',
                stroke: on ? 'var(--color-mark)' : 'var(--color-ink-soft)',
              }}
              strokeWidth={on ? 2 : 1.2}
            />
            <text
              x={STACK_W / 2}
              y={y + CELL_H / 2 + 4}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fontFamily="var(--font-mono, monospace)"
              style={{ fill: 'var(--color-ink)' }}
            >
              {text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** `marked` and `prev`, one cell per vertex, the cell the frame wrote in mark. */
function ArraysPanel({ frame }: { frame: WalkFrame }) {
  const V = frame.marked.length;
  const nameW = 62;
  const cw = 46;
  const head = 14;
  const gap = 8;
  const rowH = head + CELL_H + gap;
  const width = nameW + V * cw + 4;
  const height = 2 * rowH;
  const rowsData: { name: string; cells: string[]; hot: number }[] = [
    {
      name: 'marked',
      cells: frame.marked.map(String),
      hot: frame.wrote?.array === 'marked' ? frame.wrote.index : -1,
    },
    {
      name: 'prev',
      cells: frame.prev.map((p) => (p < 0 ? '−1' : String(p))),
      hot: frame.wrote?.array === 'prev' ? frame.wrote.index : -1,
    },
  ];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${width}px`, maxWidth: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={rowsData.map((r) => `${r.name}: ${r.cells.join(', ')}`).join('; ')}
    >
      {rowsData.map((row, r) => {
        const y = r * rowH + head;
        return (
          <g key={row.name}>
            <text
              x={nameW - 8}
              y={y + CELL_H / 2 + 4}
              textAnchor="end"
              fontSize="12"
              fontWeight="700"
              fontFamily="var(--font-mono, monospace)"
              style={{ fill: 'var(--color-ink)' }}
            >
              {row.name}
            </text>
            {row.cells.map((t, i) => {
              const x = nameW + i * cw;
              const hot = i === row.hot;
              return (
                <g key={i} data-cell={`${row.name}[${i}]`} data-hot={hot ? '' : undefined}>
                  <text
                    x={x + cw / 2}
                    y={y - 3}
                    textAnchor="middle"
                    fontSize="10"
                    style={{ fill: 'var(--color-ink-soft)' }}
                  >
                    {i}
                  </text>
                  <rect
                    x={x}
                    y={y}
                    width={cw}
                    height={CELL_H}
                    style={{
                      fill: hot ? 'var(--color-mark-soft)' : 'var(--color-surface)',
                      stroke: hot ? 'var(--color-mark)' : 'var(--color-ink-soft)',
                    }}
                    strokeWidth={hot ? 2 : 1.2}
                  />
                  <text
                    x={x + cw / 2}
                    y={y + CELL_H / 2 + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontFamily="var(--font-mono, monospace)"
                    style={{
                      fill:
                        t === 'false' || t === '−1' ? 'var(--color-ink-soft)' : 'var(--color-ink)',
                    }}
                  >
                    {t}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function asLines(spec: number | number[] | undefined): number[] {
  if (spec === undefined) return [];
  return Array.isArray(spec) ? spec : [spec];
}

function parseEdge(text: string): GraphWalkEdge {
  const [v, w] = text.split('-').map(Number);
  return [v, w];
}

function inRange(V: number, v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < V;
}
