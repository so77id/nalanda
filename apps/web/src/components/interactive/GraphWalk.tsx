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
  traceGridDfs,
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
  nodes?: NodeGraphNode[];
  /** `[v, w]`, in the order the program adds them: that order is `adj`'s. */
  edges?: [number, number][];
  /** How many columns the drawing's grid has. */
  cols?: number;
  /** How many rows the drawing's grid has. */
  rows?: number;
  /** Arcs instead of edges. */
  directed?: boolean;
  /**
   * A maze instead of `nodes` and `edges`: its rows, `.` a free cell and `#` a
   * wall. The walk runs over its implicit graph — the cell in row r and column
   * c is the vertex r · C + c, its neighbours computed with `DR4`/`DC4` and
   * `free` — and the drawing is the grid (#357 S5b). `dfs` only, for now.
   */
  grid?: string[];
  /** The vertex the walk starts from. Default the first node, or the first free cell. */
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
  const { grid, lines, code, codeSrc } = props;
  const algorithm = props.algorithm ?? 'dfs';
  if (!Object.hasOwn(EVENTS, algorithm)) {
    return (
      <AuthoringError component="GraphWalk">
        algorithm=&quot;{String(algorithm)}&quot; no existe; son dfs, dfs-iterative y
        dfs-mark-on-push.
      </AuthoringError>
    );
  }
  if (grid !== undefined && props.nodes !== undefined) {
    return (
      <AuthoringError component="GraphWalk">
        escribe nodes y edges, o grid: no los dos.
      </AuthoringError>
    );
  }
  if (grid !== undefined) {
    const problem = gridProblem(grid, algorithm, props.start);
    if (problem !== null) {
      return <AuthoringError component="GraphWalk">{problem}</AuthoringError>;
    }
  }
  const nodes = props.nodes ?? [];
  const edges = props.edges ?? [];
  if (grid === undefined && (props.nodes === undefined || props.edges === undefined)) {
    return (
      <AuthoringError component="GraphWalk">
        falta el grafo: escribe nodes y edges, o grid con el laberinto.
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
  const start = props.start ?? (grid === undefined ? 0 : firstFree(grid));
  if (grid === undefined && !inRange(V, start)) {
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
    nodes = [],
    edges = [],
    cols = 0,
    rows = 0,
    directed = false,
    grid,
    start,
    lines,
    label,
    programLines,
  } = props;
  const V = nodes.length;
  // MDX re-mints inline literals on every render: memoise on a primitive key
  // (add-a-content-component.md, the stepper rule).
  const edgesKey = edges.map(([v, w]) => `${v}-${w}`).join(',');
  const gridKey = grid?.join('\n');
  const frames = useMemo(() => {
    if (gridKey !== undefined) return traceGridDfs(gridKey.split('\n'), start);
    const parsed: GraphWalkEdge[] = edgesKey === '' ? [] : edgesKey.split(',').map(parseEdge);
    const adj = adjacencyOf(V, parsed, directed);
    if (algorithm === 'dfs') return traceDfs(adj, start);
    return traceDfsStack(adj, start, algorithm === 'dfs-iterative' ? 'pop' : 'push');
  }, [algorithm, V, edgesKey, gridKey, directed, start]);
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
        // A maze's arrays hold a cell per square, walls included: the grid
        // draws them instead, `marked` as the cells' paint, `prev` as arrows.
        <Step
          key={i}
          lines={asLines(lines[frame.event])}
          programLines={programLines}
          under={gridKey === undefined ? <ArraysPanel frame={frame} /> : undefined}
        >
          {gridKey !== undefined ? (
            <GridFrame frame={frame} grid={gridKey.split('\n')} depth={depth} label={label} />
          ) : (
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
          )}
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
          <CallStack frame={frame} depth={depth} />
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

/** The calls in progress, as the recursive walk's frames hold them. */
function CallStack({ frame, depth }: { frame: WalkFrame; depth: number }) {
  const calls = frame.stack.map((v) => `dfs(${v})`);
  return (
    <StackPanel
      title="pila de llamadas"
      items={calls}
      hot={frame.stack.length - 1}
      depth={depth}
      label={`Pila de llamadas: ${calls.join(', ')}; corre dfs(${frame.v}).`}
    />
  );
}

const GRID_CELL = 48;
const GRID_PAD = 16;

type CellState = 'wall' | 'free' | 'open' | 'running' | 'done';

const CELL_PAINT: Record<Exclude<CellState, 'wall' | 'free'>, { fill: string; stroke: string }> = {
  open: { fill: 'var(--color-mark-soft)', stroke: 'var(--color-ink-soft)' },
  running: { fill: 'var(--color-mark-soft)', stroke: 'var(--color-mark)' },
  done: { fill: 'var(--color-keep-soft)', stroke: 'var(--color-keep)' },
};

interface GridFrameProps {
  frame: WalkFrame;
  grid: string[];
  depth: number;
  label: string;
}

/**
 * A frame of the walk over a maze: the grid, each free cell numbered
 * r · C + c; the cells marked in mark while their call runs or waits and in
 * keep once it returned; `prev` as an arrow from each reached cell back to
 * the one it was reached from, those of the calls in progress in mark — the
 * thread; and, on a look, a dashed arrow to the cell asked about.
 */
function GridFrame({ frame, grid, depth, label }: GridFrameProps) {
  const onSlide = useMode() === 'presentation';
  const R = grid.length;
  const C = grid[0].length;
  const width = C * GRID_CELL + 2 * GRID_PAD;
  const height = R * GRID_CELL + 2 * GRID_PAD;
  const center = (r: number, c: number): [number, number] => [
    GRID_PAD + c * GRID_CELL + GRID_CELL / 2,
    GRID_PAD + r * GRID_CELL + GRID_CELL / 2,
  ];
  const at = (v: number) => center(Math.floor(v / C), v % C);
  const onStack = new Set(frame.stack);
  const done = new Set(frame.done);
  const stateOf = (r: number, c: number): CellState => {
    const v = r * C + c;
    if (grid[r][c] === '#') return 'wall';
    if (v === frame.v) return 'running';
    if (done.has(v)) return 'done';
    return onStack.has(v) ? 'open' : 'free';
  };
  const cells = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const state = stateOf(r, c);
      const x = GRID_PAD + c * GRID_CELL;
      const y = GRID_PAD + r * GRID_CELL;
      const paint = state === 'wall' || state === 'free' ? null : CELL_PAINT[state];
      cells.push(
        <g key={`${r},${c}`} data-cell={`${r},${c}`} data-state={state}>
          <rect
            x={x}
            y={y}
            width={GRID_CELL}
            height={GRID_CELL}
            style={{
              fill: state === 'wall' ? 'var(--color-ink-soft)' : 'var(--color-surface)',
              stroke: 'var(--color-ink-soft)',
            }}
            strokeWidth={1.4}
          />
          {paint ? (
            <rect
              x={x + 2}
              y={y + 2}
              width={GRID_CELL - 4}
              height={GRID_CELL - 4}
              style={{ fill: paint.fill, stroke: paint.stroke }}
              strokeWidth={state === 'running' ? 3 : state === 'done' ? 2 : 1.2}
            />
          ) : null}
          {state === 'wall' ? null : (
            <text
              x={x + 5}
              y={y + 13}
              fontSize="11"
              fontWeight="700"
              fontFamily="var(--font-mono, monospace)"
              style={{ fill: 'var(--color-ink)' }}
            >
              {r * C + c}
            </text>
          )}
        </g>,
      );
    }
  }
  const arrows = [];
  for (let x = 0; x < frame.prev.length; x++) {
    const p = frame.prev[x];
    if (p < 0) continue;
    const hot = onStack.has(x) || (frame.wrote?.array === 'prev' && frame.wrote.index === x);
    arrows.push(
      <g key={x} data-prev={x} data-hot={hot ? '' : undefined}>
        <Arrow from={at(x)} to={at(p)} hot={hot} />
      </g>,
    );
  }
  let look = null;
  if (frame.event === 'look' && frame.v !== null && frame.cell !== null) {
    const [r, c] = frame.cell;
    const [x1, y1] = at(frame.v);
    const [x2, y2] = center(r, c);
    const inside = r >= 0 && r < R && c >= 0 && c < C;
    look = (
      <g data-look={`${r},${c}`}>
        {inside ? (
          <rect
            x={x2 - GRID_CELL / 2 + 4}
            y={y2 - GRID_CELL / 2 + 4}
            width={GRID_CELL - 8}
            height={GRID_CELL - 8}
            fill="none"
            style={{ stroke: 'var(--color-mark)' }}
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        ) : null}
        {/* Three quarters of the way: off the grid, it ends in the margin. */}
        <Arrow from={[x1, y1]} to={[x1 + (x2 - x1) * 0.75, y1 + (y2 - y1) * 0.75]} hot dashed />
      </g>
    );
  }
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
        {/* Capped, as the graph is: the frame's height never follows the width. */}
        <div style={{ flex: '1 1 220px', maxWidth: onSlide ? '440px' : '320px' }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', height: 'auto', display: 'block' }}
            role="img"
            aria-label={`${label} ${frame.text}`}
            data-testid="graph-walk-grid"
          >
            {cells}
            {arrows}
            {look}
          </svg>
        </div>
        <CallStack frame={frame} depth={depth} />
      </div>
    </div>
  );
}

/** A straight arrow, its head at `to`: `prev` pointing back, or a look. */
function Arrow({
  from,
  to,
  hot,
  dashed = false,
}: {
  from: [number, number];
  to: [number, number];
  hot: boolean;
  dashed?: boolean;
}) {
  const [x1, y1] = from;
  const dx = to[0] - x1;
  const dy = to[1] - y1;
  const len = Math.hypot(dx, dy);
  // `prev` stops short of the cell it points to, so two arrows meeting in a
  // cell do not cover each other's heads; a look ends where it was aimed.
  const reach = dashed ? len : len - 9;
  const [ux, uy] = [dx / len, dy / len];
  const [tx, ty] = [x1 + ux * reach, y1 + uy * reach];
  const head = 7;
  const color = hot ? 'var(--color-mark)' : 'var(--color-ink-soft)';
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={tx - ux * head}
        y2={ty - uy * head}
        style={{ stroke: color }}
        strokeWidth={hot ? 3 : 1.6}
        strokeLinecap="round"
        strokeDasharray={dashed ? '5 4' : undefined}
      />
      <polygon
        points={`${tx},${ty} ${tx - ux * head - uy * 4.5},${ty - uy * head + ux * 4.5} ${tx - ux * head + uy * 4.5},${ty - uy * head - ux * 4.5}`}
        style={{ fill: color }}
      />
    </g>
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

/** What is wrong with a maze the walk is given, or null. In Spanish. */
function gridProblem(
  grid: string[],
  algorithm: GraphWalkAlgorithm,
  start: number | undefined,
): string | null {
  if (algorithm !== 'dfs') {
    return `algorithm="${algorithm}" todavía no recorre una grilla: con grid, el recorrido es dfs.`;
  }
  const lengths = grid.map((row) => row.length);
  if (grid.length === 0 || lengths[0] === 0 || lengths.some((n) => n !== lengths[0])) {
    return `las filas de grid tienen que tener todas el mismo largo, y no ser vacías (llegaron de ${lengths.join(', ')}).`;
  }
  const odd = grid.findIndex((row) => /[^.#]/.test(row));
  if (odd >= 0) {
    return `grid solo lleva . (celda libre) y # (muro); la fila ${odd} trae otro carácter.`;
  }
  const C = lengths[0];
  const s = start ?? firstFree(grid);
  const free =
    Number.isInteger(s) && s >= 0 && s < grid.length * C && grid[Math.floor(s / C)][s % C] === '.';
  if (!free) {
    return `start=${s} no es una celda libre de grid: la celda de la fila r y la columna c es r · ${C} + c.`;
  }
  return null;
}

/** The first free cell, row by row: where a maze's walk starts by default. */
function firstFree(grid: string[]): number {
  const C = grid[0]?.length ?? 0;
  const i = grid.join('').indexOf('.');
  return i < 0 || C === 0 ? -1 : i;
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
