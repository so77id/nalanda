# ADR-0092: GraphWalk — graph traversals simulated, and played by StepShow

**Status:** Accepted
**Date:** 2026-11-09
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #357 (Grafos · Recorridos), S3. Numbered after sweeping every
remote branch: `0090-*` is held by the pen-trace branch, `0091-*` by #363.

## Context

Class 3 of the Grafos unit walks three traversals step by step — depth-first
search (recursive and iterative), breadth-first search and Kahn's topological
order — over small graphs and over the grid of a maze, each frame showing
which vertices are marked, the call stack or the bag, and arrays such as
`marked`, `prev`, `dist` and the in-degrees. A walk over five or six vertices
runs twenty to forty frames.

Epic #354 planned a `graph` recipe of `<SequenceStepper>` for this (as trees,
the heap and the hash tables have, ADR-0083, ADR-0077, ADR-0084). Since then
#363 (Grafos · TDA y modelado) moved the course's code into files beside the
document, quoted by range (ADR-0091), and walked every operation of the graph
with `<StepShow>` + `<NodeGraph>`, each frame written by hand: 300 to 450 lines
per slide, where a frame copied wrong is caught by nobody.

Three ways to animate the walks were weighed with Miguel in S3.

## Decision

**A composite of `<StepShow>`, like `FibMemoSteps`/`FibTabSteps`/`FibIterSteps`
(ADR-0049): the walk is simulated, and the frames it produces become the
`<Step>`s.**

- `graphWalkTrace.ts` is pure: a graph and a start in, a list of frames out,
  each a snapshot of what the walk holds after one step. The adjacency lists
  are built in the order `AdjListGraph.addEdge` appends (#363), so the order the
  trace visits neighbours in is the one the course's Java produces.
- `GraphWalk.tsx` renders one `<Step>` per frame. **The listing is the
  document's file** (`codeSrc`/`codeRange`, ADR-0091), with its header, folds
  and «Ver archivo»; **`lines` maps each event of the walk to the FILE lines it
  lights** (`mark`, `look`, `prev`, `recurse`, `return` for `dfs`), so the
  component knows the algorithm and the document owns the code. The example
  calls go on the slide as `program`, as #363 writes them. An inline `code`
  stays legal for code that lives only on its slide (ADR-0091 §5).
- **What a frame draws**, approved by Miguel on the prototype: the running
  call in `mark`, the finished ones in `keep`, the edges the calls in progress
  were entered by (the thread) and the edge being looked at as marked edges,
  the call stack beside the graph, and the program's arrays (`marked`, `prev`)
  under the listings through `<Step under>`, the cell just written in `mark`.
- **One step per assignment, per neighbour looked at, per call and per
  return** (the course's step rule): a slide walks a graph of four or five
  vertices.
- **The drawing is capped at a fixed width** — 320px in the book, 440px on a
  slide — never a share of its column, so a frame's height cannot follow the
  width the deck gives it (the re-scale loop of #321).
- Lazy, like the fib composites: `lazyGraphWalk.tsx`, its own guard in
  `architecture.test.ts`, and an entry in `<StepShow>`'s `ALLOWED`.
- **Walks are added one at a time, each with the slide that first uses it**
  (ADR-0083's rule): S3 shipped the recursive DFS; S5a the iterative DFS and
  the tempting version that marks on push; S5b the recursive DFS over a
  maze's grid; S10 BFS with its queue and `dist`, and its tempting version;
  Kahn with its in-degrees and the line layout comes with arc III.
- **The iterative DFS marks on pop** (`dfs-iterative`): one loop over a
  `Stack`, the loop BFS shares with a queue at the close of arc II (la
  bolsa). It is drawn beside its own stack instead of the call stack; the
  vertices it has reached are kept, and its thread is the way back along
  `prev` from the vertex last popped. When a vertex is pushed again,
  `prev[w] = v` is written again, and the frame says from where `w` is now
  reached.
- **The version that marks on push** (`dfs-mark-on-push`) is a walk too, so
  its counterexample is played, not asserted: it paints red a neighbour it
  skips although it never reached it — «marked» has come to mean «seen». Its
  listing lives only on its slide (inline `code`).
- **The recursive and the iterative DFS are not paired** line by line, as
  `<SequenceStepper>`'s `iterative` pairs listings that take the same
  decisions in the same order: the iterative one reads every neighbour of a
  vertex at once and pushes it, the recursive one reads one and goes down
  (19 steps against 26 on a square), and the stack turns the neighbours'
  order around (0 1 2 3 against 0 3 2 1). Each walks on its own slide.
  Decided with Miguel in S5.
- **A maze is walked over its implicit graph** (`grid`), as class 2 models
  it: the cell in row r and column c is the vertex r · C + c, and its
  neighbours are computed up, down, left, right with `DR4`/`DC4` and `free`,
  never stored, so no `Graph` is built and the listing is
  `MazeDepthFirstPaths.java`, the same API over a grid. **Every direction is
  a `look`**, a wall and the border included, because the loop asks `free`
  about all four and class 2 walked the degree the same way; the narration
  says why the walk does not step there. That is about eight steps a cell,
  so the maze is small (eight free cells, 62 steps). **The frame is the
  grid**: `marked` and `prev` hold a cell per square, walls included, so they
  are drawn on it instead of under the listing — a marked cell painted in
  mark while its call runs or waits and in keep once it returned, `prev` as
  an arrow from each cell back to where it was reached from, the arrows of
  the calls in progress in mark (the thread), and a dashed arrow to the cell
  being looked at. Decided with Miguel in S5b.
- **The breadth-first search marks on enqueue** (`bfs`), as algs4's
  `BreadthFirstPaths`: `marked`, `dist` and `prev` under the listing, each
  reached vertex carrying its distance (`d=…`) beside it so the layers show,
  and the queue drawn front first beside the graph. `dist` starts at −1, so
  an unreached vertex reads as such. **The version that marks on dequeue**
  (`bfs-mark-on-pop`), the tree's level order copied as is, is a walk too:
  it ends, and paints red a vertex enqueued while it is already in the
  queue. It keeps neither `dist` nor `prev`, so neither is drawn. Planned in
  S9, built in S10.

## Alternatives considered

- **A `graph` recipe of `<SequenceStepper>`** (the epic's plan). It simulates
  too, and brings `iterative` and the program mode. But a recipe writes its Java
  listing inside its TypeScript trace, so the class's code would live in two
  places — the files ADR-0091 put beside the document, and the recipe — and it
  is the costliest piece to build (trace, geometry, view and their tests per
  recipe). Rejected.
- **`<StepShow>` written by hand**, as #363. Nothing to build, but 300 to 450
  lines per slide, and no check that a frame matches the algorithm. Rejected.

## Consequences

- The epic's «receta `graph` de `<SequenceStepper>`» is replaced by
  `<GraphWalk>` for the whole unit: Prim (#358) and Dijkstra (#359) add their
  walks here, the priority queue being one more bag.
- The catalog entry quotes the course's files
  (`27-grafos-recorridos.code/DepthFirstPaths.java`,
  `IterativeDepthFirstPaths.java`, `MazeDepthFirstPaths.java` and
  `BreadthFirstPaths.java`), as `<SourceFile>`'s quotes class 2's: when the
  class's code changes, the entry's ranges and `lines` move with it. The
  trace was checked against those files run on a JDK 21 (S5a, S5b, S10): the
  same order, `prev` and `dist` on the square, on the counterexample, on the
  maze and on the five-vertex graph.
- `<GraphWalk>` draws its own arrays and call stack. Class 2 keeps file-local
  figures in the same idiom (`ArrayRows`, `MazeGrid`); promoting them into
  shared components waits until #363 merges, so the two branches do not edit
  the same document at once.
- The `lines` map is checked for completeness, not for meaning: an author who
  maps `prev` to the wrong line sees the wrong line lit. The browser check of
  every walk is what catches it.
