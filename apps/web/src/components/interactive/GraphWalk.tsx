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
  traceBfs,
  traceKahn,
  traceGridBfs,
  traceGridDfs,
  traceGridDfsStack,
  type GraphWalkEdge,
  type WalkEvent,
  type WalkFrame,
} from './graphWalkTrace';
import { Step } from './Step';
import { StepShow, type BesideRatio } from './StepShow';

export type GraphWalkAlgorithm =
  'dfs' | 'dfs-iterative' | 'dfs-mark-on-push' | 'bfs' | 'bfs-mark-on-pop' | 'kahn';

/** The events of each walk, each lighting the lines an author maps it to. */
const EVENTS: Record<GraphWalkAlgorithm, readonly WalkEvent[]> = {
  dfs: ['mark', 'look', 'prev', 'recurse', 'return'],
  'dfs-iterative': ['pushStart', 'pop', 'skip', 'mark', 'look', 'prev', 'push', 'end'],
  'dfs-mark-on-push': ['markStart', 'pushStart', 'pop', 'look', 'mark', 'prev', 'push', 'end'],
  bfs: [
    'markStart',
    'distStart',
    'enqueueStart',
    'dequeue',
    'look',
    'mark',
    'dist',
    'prev',
    'enqueue',
    'end',
  ],
  'bfs-mark-on-pop': ['enqueueStart', 'dequeue', 'skip', 'mark', 'look', 'enqueue', 'end'],
  kahn: ['inDegrees', 'check', 'enqueueStart', 'dequeue', 'append', 'lower', 'enqueue', 'end'],
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
  /**
   * Whether a depth-first walk keeps `prev`, the way back. Default true;
   * false walks a search that keeps only `visited` — no `prev` event, no `prev`
   * row — for the slide that has not met the thread yet (#357 v2).
   */
  paths?: boolean;
  /**
   * Whether a breadth-first walk keeps `dist`. Default true; false walks a
   * search that keeps only `visited` and `prev` — no `dist` event, no `dist`
   * row — for the maze, whose question is the way, not how far (#357 arc II).
   */
  dist?: boolean;
  /** Arcs instead of edges. */
  directed?: boolean;
  /**
   * A maze instead of `nodes` and `edges`: its rows, `.` a free cell and `#` a
   * wall. The walk runs over its implicit graph — the cell in row r and column
   * c is the vertex r · C + c, its neighbours computed with `DR4`/`DC4` and
   * `free` — and the drawing is the grid (#357 S5b). `dfs`, `dfs-iterative` and `bfs`.
   */
  grid?: string[];
  /**
   * With `grid`, `dfs-iterative` or `bfs`: the exit cell, as r · C + c. The last frame
   * then says whether `visited` reached it — the maze's first question.
   */
  exit?: number;
  /** The vertex the walk starts from. Default the first node, or the first free cell. */
  start?: number;
  /**
   * The lines each event lights, in the listing's own numbering — the FILE's
   * when the listing comes from `codeSrc` (ADR-0091). For `dfs`: `mark`
   * (`visited[v] = true`), `look` (the `for` and its `if`), `prev`
   * (`prev[w] = v`), `recurse` (the call) and `return` (the method's end).
   * For `dfs-iterative`: `pushStart` (the stack and its first push), `pop`,
   * `skip` (the `if (visited[v]) continue`), `mark`, `look`, `prev`, `push`
   * and `end` (the loop's test, failing). For `dfs-mark-on-push`: the same
   * without `skip`, plus `markStart` (`visited[s] = true`).
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
  /**
   * The program's lines lit on the last frame instead: where the program uses
   * what the walk left, as the maze's prints `visited[t]` (#357 review).
   */
  programLinesAtEnd?: number[];
  /**
   * Where a graph's arrays go: under the listing (the default, #363's place
   * for what the program holds) or under the drawing, beside the graph they
   * describe (#357 review, «La búsqueda que cuenta los saltos»). A maze's
   * always go under its grid.
   */
  arraysAt?: 'listing' | 'drawing';
  /** On a slide, the drawing beside the listing (`<StepShow beside>`). */
  beside?: boolean;
  /** With `beside`, the "code/drawing" split. */
  ratio?: BesideRatio;
  title?: string;
  /** What the graph is, in Spanish; each frame's drawing adds what it shows. */
  label: string;
  /**
   * A line under every frame's drawing, in Spanish: what each numbered vertex
   * stands for («0 Ana · 1 Beto · …»), when the walk numbers named things.
   */
  caption?: string;
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
        algorithm=&quot;{String(algorithm)}&quot; no existe; son dfs, dfs-iterative,
        dfs-mark-on-push, bfs, bfs-mark-on-pop y kahn.
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
  const missing = EVENTS[algorithm].filter(
    (e) =>
      lines[e] === undefined &&
      !(e === 'prev' && props.paths === false) &&
      !((e === 'dist' || e === 'distStart') && props.dist === false),
  );
  if (missing.length > 0) {
    return (
      <AuthoringError component="GraphWalk">
        faltan en lines las líneas de {missing.join(', ')}: cada paso del recorrido ilumina la línea
        que lo hace.
      </AuthoringError>
    );
  }
  if (algorithm === 'kahn' && !props.directed) {
    return (
      <AuthoringError component="GraphWalk">
        kahn ordena un grafo dirigido: escribe directed.
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
  const onSlide = useMode() === 'presentation';
  const {
    algorithm,
    nodes = [],
    edges = [],
    cols = 0,
    rows = 0,
    directed = false,
    paths = true,
    dist = true,
    grid,
    exit,
    start,
    lines,
    label,
    programLines,
    programLinesAtEnd,
    arraysAt = 'listing',
  } = props;
  const V = nodes.length;
  // MDX re-mints inline literals on every render: memoise on a primitive key
  // (add-a-content-component.md, the stepper rule).
  const edgesKey = edges.map(([v, w]) => `${v}-${w}`).join(',');
  const gridKey = grid?.join('\n');
  const frames = useMemo(() => {
    if (gridKey !== undefined) {
      const rows = gridKey.split('\n');
      if (algorithm === 'bfs') return traceGridBfs(rows, start, { dist, prev: paths }, exit);
      return algorithm === 'dfs-iterative'
        ? traceGridDfsStack(rows, start, paths, exit)
        : traceGridDfs(rows, start);
    }
    const parsed: GraphWalkEdge[] = edgesKey === '' ? [] : edgesKey.split(',').map(parseEdge);
    const adj = adjacencyOf(V, parsed, directed);
    if (algorithm === 'dfs') return traceDfs(adj, start, paths);
    if (algorithm === 'kahn') return traceKahn(adj);
    if (algorithm === 'bfs') return traceBfs(adj, start, 'push', { dist, prev: paths });
    if (algorithm === 'bfs-mark-on-pop') return traceBfs(adj, start, 'pop');
    return traceDfsStack(adj, start, algorithm === 'dfs-iterative' ? 'pop' : 'push', paths);
  }, [algorithm, V, edgesKey, gridKey, directed, start, paths, dist, exit]);
  const arrays: ArrayName[] =
    algorithm === 'kahn'
      ? ['inDegree', 'order']
      : algorithm === 'bfs'
        ? (['visited', ...(dist ? ['dist'] : []), ...(paths ? ['prev'] : [])] as ArrayName[])
        : algorithm === 'bfs-mark-on-pop'
          ? ['visited']
          : paths
            ? ['visited', 'prev']
            : ['visited'];
  const depth = Math.max(...frames.map((f) => f.stack.length));

  return (
    <StepShow
      code={props.code}
      codeSrc={props.codeSrc}
      codeRange={props.codeRange}
      // A named listing is what lets `<StepShow>` show `under`; a file names
      // itself, an inline listing is named after the method it holds.
      codeName={
        props.codeName ??
        (props.codeSrc === undefined ? (algorithm.startsWith('bfs') ? 'bfs' : 'dfs') : undefined)
      }
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
        // `visited` and `prev` are the program's own variables, passed to the
        // walk: they go under the listings, where `<StepShow>` shows what the
        // program holds (#363), and leave the drawing the graph and the stack.
        // A maze's hold a cell per square, walls included, and go under the
        // grid instead: under a maze's listing they cost the slide its floor
        // (#357 review), and beside the grid they sit by the numbers that
        // index them. The grid keeps only the paint and the thread.
        <Step
          key={i}
          lines={asLines(lines[frame.event])}
          programLines={
            programLinesAtEnd !== undefined && i === frames.length - 1
              ? programLinesAtEnd
              : programLines
          }
          under={
            gridKey === undefined && arraysAt === 'listing' ? (
              <ArraysPanel frame={frame} rows={arrays} />
            ) : undefined
          }
        >
          {gridKey !== undefined ? (
            <GridFrame
              frame={frame}
              grid={gridKey.split('\n')}
              depth={depth}
              label={label}
              bag={algorithm === 'dfs' ? 'calls' : algorithm === 'bfs' ? 'queue' : 'stack'}
              arrays={arrays}
              exit={exit}
            />
          ) : (
            <Frame
              frame={frame}
              nodes={nodes}
              edges={edges}
              cols={cols}
              rows={rows}
              directed={directed}
              bag={
                algorithm === 'dfs'
                  ? 'calls'
                  : algorithm === 'kahn'
                    ? 'sources'
                    : algorithm.startsWith('bfs')
                      ? 'queue'
                      : 'stack'
              }
              depth={depth}
              label={label}
              arrays={arraysAt === 'drawing' ? arrays : undefined}
            />
          )}
          {props.caption ? (
            <p
              className="m-0 text-center"
              style={{ fontSize: onSlide ? '1.2rem' : '0.8rem', color: 'var(--color-ink-soft)' }}
              data-testid="graph-walk-caption"
            >
              {props.caption}
            </p>
          ) : null}
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
  /**
   * What holds the vertices still to walk: the recursive walk's call stack,
   * the iterative one's own stack, or the breadth-first walk's queue.
   */
  bag: 'calls' | 'stack' | 'queue' | 'sources';
  depth: number;
  label: string;
  /** The program's arrays, when they go under the drawing instead of the listing. */
  arrays?: ArrayName[];
}

function Frame({
  frame,
  nodes,
  edges,
  cols,
  rows,
  directed,
  bag,
  depth,
  label,
  arrays,
}: FrameProps) {
  const recursive = bag === 'calls';
  // On a slide the drawing has its own column (`beside`) and the code is set
  // large: the graph takes more of it. Both caps are fixed numbers, never a
  // share of the column, so the frame's height never follows its width.
  const onSlide = useMode() === 'presentation';
  // Seven columns or more: the network and the friends.
  const wide = cols >= 7;
  const tones: Record<string, NodeGraphTone> = {};
  // One meaning for every walk of the class: green is marked (Kahn: on the
  // line), amber is the vertex the walk is on, red is what goes wrong.
  const kept = bag === 'sources' ? frame.order : frame.marked.flatMap((m, v) => (m ? [v] : []));
  for (const v of kept) tones[String(v)] = 'keep';
  if (frame.v !== null) tones[String(frame.v)] = 'mark';
  // Marking on push: a neighbour skipped though the walk never reached it.
  if (frame.unvisited && frame.w !== null) tones[String(frame.w)] = 'flag';
  // Marking on dequeue: a vertex enqueued while it is already in the queue.
  if (frame.twice && frame.w !== null) tones[String(frame.w)] = 'flag';
  if (bag === 'sources') {
    // Kahn: the vertex the first loop asks about, and, once the queue runs
    // out, the vertices a cycle left off the line.
    if (frame.v === null && frame.w !== null) tones[String(frame.w)] = 'mark';
    if (frame.event === 'end') {
      for (let v = 0; v < frame.marked.length; v++) {
        if (!frame.order.includes(v)) tones[String(v)] = 'flag';
      }
    }
  }
  // Breadth-first: each reached vertex carries its distance, its layer.
  const notes: Record<string, string> = {};
  if (frame.dist !== null) {
    frame.dist.forEach((d, v) => {
      // An unreached vertex keeps its note's room, so the drawing never grows.
      // One character, a digit: a wider note reaches over its vertex.
      notes[String(v)] = d >= 0 ? String(d) : '\u00a0';
    });
  }
  const thread = recursive
    ? // The edge each call in progress was entered by.
      frame.stack.slice(1).map((v, i): NodeGraphEdge => [frame.stack[i], v])
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
      <div
        style={{
          fontSize: onSlide ? '1.2rem' : '0.9rem',
          textAlign: 'center',
          lineHeight: 1.4,
          minHeight: '2.8em',
        }}
      >
        {frame.text}
      </div>
      <div className="flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {/* Capped so the frame's height never depends on the panel's width:
            a drawing that grows with it makes the deck re-scale for ever. On
            a slide a wide graph takes the whole row, its stack or queue
            below it, or it is drawn too small to read from the back. */}
        <div
          style={{
            flex: onSlide ? (wide ? '1 1 100%' : '1 1 400px') : '1 1 220px',
            maxWidth: onSlide ? (wide ? '680px' : '520px') : '320px',
          }}
        >
          <NodeGraph
            nodes={nodes}
            // Kahn takes an arc out of the graph once it stops counting.
            edges={
              frame.gone.length === 0
                ? edges
                : edges.filter(([a, b]) => !frame.gone.some(([x, y]) => x === a && y === b))
            }
            cols={cols}
            rows={rows}
            directed={directed}
            tones={tones}
            notes={notes}
            markEdges={[...thread, ...looking]}
            maxScale={onSlide ? 2 : undefined}
            label={`${label} ${frame.text}`}
          />
          {bag === 'sources' ? (
            <LinePanel order={frame.order} edges={edges} V={nodes.length} />
          ) : null}
        </div>
        {recursive ? (
          <CallStack frame={frame} depth={depth} />
        ) : bag === 'queue' || bag === 'sources' ? (
          <QueuePanel
            frame={frame}
            depth={depth}
            title={bag === 'sources' ? 'cola de fuentes' : 'cola'}
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
      {arrays ? (
        <div className="flex w-full justify-center">
          <ArraysPanel frame={frame} rows={arrays} />
        </div>
      ) : null}
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
  open: { fill: 'var(--color-keep-soft)', stroke: 'var(--color-keep)' },
  running: { fill: 'var(--color-mark-soft)', stroke: 'var(--color-mark)' },
  done: { fill: 'var(--color-keep-soft)', stroke: 'var(--color-keep)' },
};

interface GridFrameProps {
  frame: WalkFrame;
  grid: string[];
  depth: number;
  label: string;
  /**
   * What holds the pending cells, drawn beside the grid: the calls in
   * progress (`dfs`), a stack of its own (`dfs-iterative`) or a queue
   * (`bfs`). With a stack or a queue, the cells reached are kept, the cell
   * being expanded is in mark and the thread is the way back along `prev`.
   */
  bag: 'calls' | 'stack' | 'queue';
  /** The program's arrays, drawn under the grid. */
  arrays: ArrayName[];
  /** The exit cell: once the walk ends, the thread is the way back from it. */
  exit?: number;
}

/**
 * A frame of the walk over a maze: the grid, each free cell numbered
 * r · C + c; the cells marked in mark while their call runs or waits and in
 * keep once it returned; the thread, one line in mark from the start to the
 * cell the walk is on — the calls in progress, or the way back along `prev`
 * — as the maze slides draw Teseo's thread; and, on a look, a dashed arrow to
 * the cell asked about. Under them, the program's arrays, `prev` among them.
 */
function GridFrame({ frame, grid, depth, label, bag, arrays, exit }: GridFrameProps) {
  const iterative = bag !== 'calls';
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
  // The thread: the calls in progress, or, with a stack of its own, the way
  // back along `prev` from the cell last marked — never from a copy popped
  // only to be discarded, which drew a way the walk was not on (#357 review).
  const thread = iterative ? threadCells(frame, exit) : frame.stack;
  const onStack = new Set(thread);
  // A queue marks on enqueue: every cell it reached is kept, queued or not.
  const done = new Set(
    bag === 'queue'
      ? frame.marked.flatMap((m, v) => (m ? [v] : []))
      : iterative
        ? frame.order
        : frame.done,
  );
  const stateOf = (r: number, c: number): CellState => {
    const v = r * C + c;
    if (grid[r][c] === '#') return 'wall';
    if (v === frame.v && (!iterative || frame.marked[v])) return 'running';
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
              fill: state === 'wall' ? 'var(--color-rule-strong)' : 'var(--color-surface)',
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
          {state !== 'wall' && frame.dist !== null && frame.dist[r * C + c] >= 0 ? (
            // The distance, where the breadth-first walk keeps one: the layers show.
            <text
              x={x + GRID_CELL - 5}
              y={y + GRID_CELL - 6}
              textAnchor="end"
              fontSize="14"
              fontWeight="700"
              data-dist={r * C + c}
              style={{ fill: 'var(--color-ink)' }}
            >
              {frame.dist[r * C + c]}
            </text>
          ) : null}
        </g>,
      );
    }
  }
  const last = thread.length > 0 ? at(thread[thread.length - 1]) : null;
  const threadLine = (
    <g data-thread={thread.join(',')}>
      {thread.length > 1 ? (
        <polyline
          points={thread.map((v) => at(v).join(',')).join(' ')}
          fill="none"
          style={{ stroke: 'var(--color-mark)' }}
          strokeWidth={4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {last ? (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={6.5}
          style={{ fill: 'var(--color-mark)', stroke: 'var(--color-surface)' }}
          strokeWidth={2}
        />
      ) : null}
    </g>
  );
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
        <LookArrow from={[x1, y1]} to={[x1 + (x2 - x1) * 0.75, y1 + (y2 - y1) * 0.75]} />
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
      <div
        style={{
          fontSize: onSlide ? '1.2rem' : '0.9rem',
          textAlign: 'center',
          lineHeight: 1.4,
          minHeight: '2.8em',
        }}
      >
        {frame.text}
      </div>
      <div className="flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {/* Capped, as the graph is: the frame's height never follows the width. */}
        <div
          style={{
            flex: '1 1 220px',
            maxWidth: onSlide ? '520px' : '320px',
          }}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', height: 'auto', display: 'block' }}
            role="img"
            aria-label={`${label} ${frame.text}`}
            data-testid="graph-walk-grid"
          >
            {cells}
            {threadLine}
            {look}
          </svg>
        </div>
        {bag === 'queue' ? (
          <QueuePanel frame={frame} depth={depth} title="cola" />
        ) : iterative ? (
          <StackPanel
            title="pila"
            items={frame.stack.map(String)}
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
        ) : (
          <CallStack frame={frame} depth={depth} />
        )}
      </div>
      <div className="flex w-full justify-center">
        <ArraysPanel frame={frame} rows={arrays} narrow />
      </div>
    </div>
  );
}

/** The dashed arrow of a look, in mark, its head at `to`, where it was aimed. */
function LookArrow({ from, to }: { from: [number, number]; to: [number, number] }) {
  const [x1, y1] = from;
  const dx = to[0] - x1;
  const dy = to[1] - y1;
  const len = Math.hypot(dx, dy);
  const [ux, uy] = [dx / len, dy / len];
  const [tx, ty] = to;
  const head = 7;
  const color = 'var(--color-mark)';
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={tx - ux * head}
        y2={ty - uy * head}
        style={{ stroke: color }}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="5 4"
      />
      <polygon
        points={`${tx},${ty} ${tx - ux * head - uy * 4.5},${ty - uy * head + ux * 4.5} ${tx - ux * head + uy * 4.5},${ty - uy * head - ux * 4.5}`}
        style={{ fill: color }}
      />
    </g>
  );
}

/**
 * The thread of an iterative walk over a maze, its cells from the start: to
 * the cell it marked last — the way the recursive walk's calls in progress
 * hold — and, once it ended, to the `exit` it reached, the way it found.
 */
function threadCells(frame: WalkFrame, exit?: number): number[] {
  const reachedExit = frame.event === 'end' && exit !== undefined && frame.marked[exit] === true;
  const end = reachedExit ? exit : frame.order[frame.order.length - 1];
  if (end === undefined) return [];
  const out = [end];
  // A walk of V cells has at most V − 1 steps back; the bound is a guard.
  for (let i = 0; i < frame.prev.length && frame.prev[out[out.length - 1]] >= 0; i++) {
    out.push(frame.prev[out[out.length - 1]]);
  }
  return out.reverse();
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

/**
 * How much larger a panel is drawn on a slide: a projected deck is read from
 * the back of the room, and the slide scales everything down to fit (#357
 * review). A fixed factor, never a share of the column (the re-scale loop of
 * #321).
 */
function usePanelScale(): number {
  return useMode() === 'presentation' ? 1.5 : 1;
}
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
  const k = usePanelScale();
  const head = 18;
  const height = head + depth * (CELL_H + 4) + 4;
  return (
    <svg
      viewBox={`0 0 ${STACK_W} ${height}`}
      style={{ width: `${STACK_W * k}px`, maxWidth: '100%', height: 'auto', display: 'block' }}
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

/**
 * Kahn's line: the vertices in the order they were appended, each arc between
 * two of them drawn above as a bow from tail to head. In a topological order
 * every bow points right.
 */
function LinePanel({ order, edges, V }: { order: number[]; edges: [number, number][]; V: number }) {
  const k = usePanelScale();
  const gap = 46;
  const r = 13;
  const width = Math.max(1, V) * gap + 16;
  const y = 70;
  const height = y + r + 8;
  const at = new Map(order.map((v, i) => [v, 16 + gap / 2 + i * gap - gap / 2 + r]));
  const bows = edges.filter(([u, v]) => at.has(u) && at.has(v));
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: '100%',
        maxWidth: `${width * k}px`,
        height: 'auto',
        display: 'block',
        margin: '0 auto',
      }}
      role="img"
      aria-label={
        order.length === 0
          ? 'La línea está vacía.'
          : `La línea, de izquierda a derecha: ${order.join(', ')}.`
      }
      data-testid="graph-walk-line"
    >
      <text x={4} y={12} fontSize="11" style={{ fill: 'var(--color-ink-soft)' }}>
        línea
      </text>
      <line
        x1={4}
        y1={y}
        x2={width - 4}
        y2={y}
        style={{ stroke: 'var(--color-rule)' }}
        strokeWidth={1.2}
        strokeDasharray="4 3"
      />
      {bows.map(([u, v]) => {
        const x1 = at.get(u)!;
        const x2 = at.get(v)!;
        const right = x2 > x1;
        const lift = 14 + Math.abs(x2 - x1) * 0.28;
        const color = right ? 'var(--color-ink-soft)' : 'var(--color-flag)';
        return (
          <g key={`${u}-${v}`} data-bow={`${u}-${v}`} data-right={right ? '' : undefined}>
            <path
              d={`M ${x1} ${y - r} Q ${(x1 + x2) / 2} ${y - r - lift} ${x2} ${y - r - 2}`}
              fill="none"
              style={{ stroke: color }}
              strokeWidth={1.6}
            />
            <polygon
              points={`${x2},${y - r} ${x2 + (right ? -7 : 7)},${y - r - 6} ${x2 + (right ? -1 : 1)},${y - r - 9}`}
              style={{ fill: color }}
            />
          </g>
        );
      })}
      {order.map((v) => (
        <g key={v}>
          <circle
            cx={at.get(v)}
            cy={y}
            r={r}
            style={{ fill: 'var(--color-keep-soft)', stroke: 'var(--color-keep)' }}
            strokeWidth={1.8}
          />
          <text
            x={at.get(v)}
            y={y + 4}
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            style={{ fill: 'var(--color-ink)' }}
          >
            {v}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** The breadth-first walk's queue, its front at the left, `depth` cells wide. */
function QueuePanel({ frame, depth, title }: { frame: WalkFrame; depth: number; title: string }) {
  const k = usePanelScale();
  const cw = 34;
  const head = 18;
  const width = Math.max(1, depth, 4) * (cw + 4) + 8;
  const height = head + CELL_H + 18;
  const enqueued = frame.event === 'enqueue' || frame.event === 'enqueueStart';
  const items = frame.stack;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${width * k}px`, maxWidth: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={
        items.length === 0
          ? 'La cola está vacía.'
          : `Cola, del frente al final: ${items.join(', ')}.`
      }
      data-testid="graph-walk-queue"
    >
      <text x={4} y={12} fontSize="11" style={{ fill: 'var(--color-ink-soft)' }}>
        {title}
      </text>
      {items.map((v, i) => {
        const x = 4 + i * (cw + 4);
        const last = i === items.length - 1;
        const bad = last && frame.twice;
        const on = last && enqueued;
        return (
          <g key={i} data-queue-cell={v} data-hot={on ? '' : undefined}>
            <rect
              x={x}
              y={head}
              width={cw}
              height={CELL_H}
              rx={4}
              style={{
                fill: bad
                  ? 'var(--color-flag-soft)'
                  : on
                    ? 'var(--color-mark-soft)'
                    : 'var(--color-surface)',
                stroke: bad
                  ? 'var(--color-flag)'
                  : on
                    ? 'var(--color-mark)'
                    : 'var(--color-ink-soft)',
              }}
              strokeWidth={on || bad ? 2 : 1.2}
            />
            <text
              x={x + cw / 2}
              y={head + CELL_H / 2 + 4}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fontFamily="var(--font-mono, monospace)"
              style={{ fill: 'var(--color-ink)' }}
            >
              {v}
            </text>
          </g>
        );
      })}
      <text x={4} y={height - 3} fontSize="10" style={{ fill: 'var(--color-ink-soft)' }}>
        ↑ frente
      </text>
    </svg>
  );
}

/** `visited` and `prev`, one cell per vertex, the cell the frame wrote in mark. */
type ArrayName = 'visited' | 'dist' | 'prev' | 'inDegree' | 'order';

/**
 * The program's arrays, one cell per vertex, the cell the frame wrote in
 * mark: `visited` and `prev` for a search, `dist` too for the breadth-first
 * one; `inDegree` and the list `order`, filled from its start, for Kahn's.
 */
function ArraysPanel({
  frame,
  rows,
  narrow = false,
}: {
  frame: WalkFrame;
  rows: ArrayName[];
  /** A maze's: a cell per square, so as narrow as `false` allows. */
  narrow?: boolean;
}) {
  const k = usePanelScale();
  const V = frame.marked.length;
  const nameW = 76;
  const cw = narrow ? 40 : 46;
  // Every array has V cells, so the indices are written once, over the first
  // row: on a slide each repeated header cost a row's worth of height.
  const head = 14;
  const gap = 8;
  const rowH = CELL_H + gap;
  const width = nameW + V * cw + 4;
  const minus = (n: number) => (n < 0 ? '−1' : String(n));
  const hotIn = (array: ArrayName) => (frame.wrote?.array === array ? frame.wrote.index : -1);
  const cellsOf = (name: ArrayName): string[] => {
    if (name === 'visited') return frame.marked.map(String);
    if (name === 'prev') return frame.prev.map(minus);
    if (name === 'dist') return (frame.dist ?? []).map(minus);
    if (name === 'inDegree') return (frame.inDegree ?? []).map(String);
    return Array.from({ length: V }, (_, i) =>
      i < frame.order.length ? String(frame.order[i]) : '',
    );
  };
  const rowsData = rows.map((name) => ({ name, cells: cellsOf(name), hot: hotIn(name) }));
  const height = head + rowsData.length * rowH;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: `${width * k}px`, maxWidth: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={rowsData.map((r) => `${r.name}: ${r.cells.join(', ')}`).join('; ')}
    >
      {rowsData.map((row, r) => {
        const y = head + r * rowH;
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
                  {r === 0 ? (
                    <text
                      x={x + cw / 2}
                      y={y - 3}
                      textAnchor="middle"
                      fontSize="10"
                      style={{ fill: 'var(--color-ink-soft)' }}
                    >
                      {i}
                    </text>
                  ) : null}
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
                    style={{ fill: cellInk(t) }}
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
  if (algorithm !== 'dfs' && algorithm !== 'dfs-iterative' && algorithm !== 'bfs') {
    return `algorithm="${algorithm}" todavía no recorre una grilla: con grid, el recorrido es dfs, dfs-iterative o bfs.`;
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

/**
 * The ink of a value in an array: a boolean in its meaning's colour, as every
 * drawing of the class paints it — true in keep, false in flag — and −1, an
 * entry not written yet, faint.
 */
function cellInk(t: string): string {
  if (t === 'true') return 'var(--color-keep)';
  if (t === 'false') return 'var(--color-flag)';
  if (t === '−1') return 'var(--color-ink-soft)';
  return 'var(--color-ink)';
}
