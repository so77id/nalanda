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
  type DfsEvent,
  type GraphWalkEdge,
  type WalkFrame,
} from './graphWalkTrace';
import { Step } from './Step';
import { StepShow } from './StepShow';

/** The events of a depth-first walk, each lighting the lines an author maps it to. */
const DFS_EVENTS: readonly DfsEvent[] = ['mark', 'look', 'prev', 'recurse', 'return'];

export interface GraphWalkProps {
  /** The walk to simulate. Only `dfs` (recursive) so far. */
  algorithm?: 'dfs';
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
   */
  lines: Partial<Record<DfsEvent, number | number[]>>;
  /** The listing, written in the document. Or `codeSrc`. */
  code?: string;
  /** The file the listing quotes, relative to the document (ADR-0091). */
  codeSrc?: string;
  codeRange?: string;
  /** The badge over the listing: `Traversals.java`. */
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
  if (algorithm !== 'dfs') {
    return (
      <AuthoringError component="GraphWalk">
        algorithm=&quot;{String(algorithm)}&quot; no existe; por ahora solo dfs.
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
  const missing = DFS_EVENTS.filter((e) => lines[e] === undefined);
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
  return <Body {...props} start={start} />;
}

function Body(props: GraphWalkProps & { start: number }) {
  const { nodes, edges, cols, rows, directed = false, start, lines, label, programLines } = props;
  const V = nodes.length;
  // MDX re-mints inline literals on every render: memoise on a primitive key
  // (add-a-content-component.md, the stepper rule).
  const edgesKey = edges.map(([v, w]) => `${v}-${w}`).join(',');
  const frames = useMemo(() => {
    const parsed: GraphWalkEdge[] = edgesKey === '' ? [] : edgesKey.split(',').map(parseEdge);
    return traceDfs(adjacencyOf(V, parsed, directed), start);
  }, [V, edgesKey, directed, start]);
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
  depth: number;
  label: string;
}

function Frame({ frame, nodes, edges, cols, rows, directed, depth, label }: FrameProps) {
  // On a slide the drawing has its own column (`beside`) and the code is set
  // large: the graph takes more of it. Both caps are fixed numbers, never a
  // share of the column, so the frame's height never follows its width.
  const onSlide = useMode() === 'presentation';
  const tones: Record<string, NodeGraphTone> = {};
  for (const v of frame.done) tones[String(v)] = 'keep';
  tones[String(frame.v)] = 'mark';
  // The thread: the edge each call in progress was entered by.
  const thread: NodeGraphEdge[] = frame.stack.slice(1).map((v) => [frame.prev[v], v]);
  const looking: NodeGraphEdge[] = frame.w === null ? [] : [[frame.v, frame.w]];
  return (
    <div
      className="flex flex-col items-center gap-1"
      data-testid="graph-walk-frame"
      data-event={frame.event}
      data-v={frame.v}
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
        <CallStackPanel stack={frame.stack} depth={depth} />
      </div>
    </div>
  );
}

const CELL_H = 26;
const STACK_W = 92;

/** The calls in progress, the first at the bottom; the running one in mark. */
function CallStackPanel({ stack, depth }: { stack: number[]; depth: number }) {
  const head = 18;
  const height = head + depth * (CELL_H + 4) + 4;
  const top = stack.length - 1;
  return (
    <svg
      viewBox={`0 0 ${STACK_W} ${height}`}
      style={{ width: `${STACK_W}px`, maxWidth: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={`Pila de llamadas: ${stack.map((v) => `dfs(${v})`).join(', ')}; corre dfs(${stack[top]}).`}
    >
      <text
        x={STACK_W / 2}
        y={12}
        textAnchor="middle"
        fontSize="11"
        style={{ fill: 'var(--color-ink-soft)' }}
      >
        pila de llamadas
      </text>
      {stack.map((v, i) => {
        const y = height - 4 - (i + 1) * (CELL_H + 4) + 4;
        const hot = i === top;
        return (
          <g key={i}>
            <rect
              x={4}
              y={y}
              width={STACK_W - 8}
              height={CELL_H}
              rx={4}
              style={{
                fill: hot ? 'var(--color-mark-soft)' : 'var(--color-surface)',
                stroke: hot ? 'var(--color-mark)' : 'var(--color-ink-soft)',
              }}
              strokeWidth={hot ? 2 : 1.2}
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
              dfs({v})
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
    { name: 'marked', cells: frame.marked.map(String), hot: frame.event === 'mark' ? frame.v : -1 },
    {
      name: 'prev',
      cells: frame.prev.map((p) => (p < 0 ? '−1' : String(p))),
      hot: frame.event === 'prev' && frame.w !== null ? frame.w : -1,
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
                <g key={i}>
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
