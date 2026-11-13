# Guide — Teach an algorithm

How a class presents an algorithm: the same six beats for every algorithm, so
the reader always knows where the story stands. Agreed with Miguel on
2026-11-12, re-planning #357 (Grafos · Recorridos) after he rejected its first
draft: «primero solucionemos un problema en el grafo dado, y la solución es con
el algoritmo, y aprovechamos de introducir el algoritmo … y después otro
problema que sea con un grafo implícito».

## When to use

You are writing a class whose subject is an algorithm, or several: the graph
traversals (#357), the shortest paths (#359), the minimum spanning tree (#358),
and any later class built around a procedure rather than a structure. A class
about a data structure follows [`teach-a-data-structure.md`](teach-a-data-structure.md);
the voice and the titles follow [`course-content-style.md`](course-content-style.md);
each worked exercise follows [`write-an-exercise.md`](write-an-exercise.md).

## The six beats

Each algorithm is one arc, and each arc runs these beats in this order:

1. **The problem**, on a given graph — an explicit one, read as a list of edges
   or drawn — stated without its solution. A concrete situation (a power
   network after a cut; how many friends apart two people are; in what order
   to take the courses of a malla), the question in words, the graph drawn,
   its input and output, and the named problem (epic #354 §Hilos 1) named
   with its question («la alcanzabilidad: ¿se puede llegar de aquí a allá?»),
   so the reader knows from the start which question the arc answers.
2. **Why what is known does not reach.** The tool the reader already has, tried
   on that same problem and failing, with the counterexample **drawn** (or
   walked) before the claim. The failure is what each piece of the algorithm
   answers: the tree's preorder loops on a graph, so the search marks.
3. **The algorithm**, introduced as the way to solve that problem:
   - the rule, in one bold sentence, and its name;
   - **why it works**, when it is not obvious — an invariant (the queue holds
     two consecutive layers at most) or a lemma argued by drawing (every DAG
     has a source); one sentence when it is obvious (each vertex is marked
     once and never unmarked);
   - the code, quoted from its file (ADR-0091), and walked once, on the
     problem's own graph (`<GraphWalk>`, ADR-0092);
   - its cost, time and memory, each with its reason.
   A variant that matters goes here too, on the same problem and its own
   slide (the depth-first search with a `Stack` after the recursive one), with
   what it changes drawn (the neighbours come out reversed; a vertex can sit
   twice in the stack). A trap the variant sets is answered where the reader
   asks it: why the stack cannot mark on push is told with the queue, which
   can (the stack's copy that counts is the last one in, the queue's the
   first).
4. **The solution** of the problem with the algorithm: the program that
   answers the question, its output, and the answer drawn on the graph.
5. **A second problem, on an implicit graph** — a maze, a grid, a state
   space — solved with the same algorithm, where how the neighbours are
   obtained changes. It shows the algorithm is general, and it may bring what
   its own question needs and the first did not ask for (the maze asks by
   which cells: `prev`, the thread and `path` are born there), or motivate
   what the first problem could not. When no implicit problem fits
   naturally (Kahn's topological order), the second problem is another
   situation, and the arc is written so the absence does not show.
6. **What it cannot answer**: the question the algorithm leaves open, shown on
   a drawing, which opens the next arc — or, for the class's last arc, its
   `## Lo que sigue`.

## Rules that cut across the arcs

- **Explicit before implicit.** The first problem's only new idea is the
  algorithm; the second's new ideas are computing the neighbours and what its
  own question needs (a way back, for a path), nothing else. The exception is
  an arc opened by the question the previous arc left open on an implicit
  graph: it starts there, where the reader already knows the neighbours. The
  breadth-first search opens on the maze's shortest way out, which the
  depth-first search did not find, and its explicit problem (the friends, at
  how many hops) comes second.
- **Born from what the reader knows.** The algorithm grows out of a tool
  already taught (the tree's preorder → the depth-first search; the level order
  with a queue → the breadth-first search), and the slide says so in place,
  without naming the class it came from (`course-content-style.md` §4b).
- **One walk per algorithm, one input.** Several runs teach something else and
  go in the program mode (`teach-a-data-structure.md` §4bis).
- **Exercises after the material.** The arcs carry two problems each; the
  worked and posed exercises are decided once the arcs are written.

## Sources

The canonical courses that state a method say the same: MIT 6.006 presents
every algorithm as *Problem / Algorithm / Correctness / Efficiency*;
Princeton COS 226 opens its course on «model the problem → design an algorithm
→ efficient? → understand why not → try again»; COS 226 (2026) and Berkeley
CS61B open each traversal on a problem («Reachability problem…»,
`connected(s, t)`). Erickson's *Algorithms*, COS 226 and Kleinberg–Tardos apply
a traversal to an implicit grid (flood fill) right after the explicit case.

## Worked case

`content/courses/sample-course/27-grafos-recorridos.mdx` (#357): the
depth-first search (the power network, its pieces, then the maze), then the
breadth-first search (the maze's shortest way out, the friends at how many
hops, then a fire with several foci). Kahn's topological order (the malla,
then a spreadsheet's circular reference) joins it in #357's second PR.
