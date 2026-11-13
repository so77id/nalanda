import {
  BinaryPicture,
  NodeGraph,
  OrderRule,
  StepBoxes,
  ChainTable,
  Explanation,
  Figure,
  LazyBenchmark,
  LazyBinarySearchOnArray,
  LazyMaxSubarrayViz,
  LazyClosestPairViz,
  LazyKaratsubaViz,
  LazyCallStack,
  LazyCodeEditor,
  LazyHanoiPlayground,
  LazyPenTrace,
  LazyComplexityCounter,
  LazyComplexityExercise,
  LazyComplexityHierarchy,
  LazyMathPlot,
  LazyExercise,
  LazyFibIterSteps,
  LazyFibMemoSteps,
  LazyFibTabSteps,
  LazyGraphWalk,
  LazyMermaid,
  LazyPredictOutput,
  LazySortStepper,
  LazySequenceStepper,
  LazyMergeStepper,
  LazyPartitionStepper,
  LazySourceFile,
  LazyStepShow,
  MathTex,
  MdxPre,
  MemoryVisual,
  Mosaic,
  Question,
  Questions,
  RecursionTree,
  FloodFill,
  DivideCombineTree,
  DecisionTreeSort,
  SectionBreak,
  PdfEmbed,
  SheetEmbed,
  SideBySide,
  PresentationWide,
  Slide,
  Split,
  Step,
  VideoEmbed,
} from '../components';
import { contentMdxComponents } from '../content';

/**
 * The full MDX components map — shell-composed so features stay decoupled
 * (content maps its elements; catalog components register here). Documents
 * use structural components without imports (ADR-0003 / ADR-0010).
 */
export const mdxComponents = {
  ...contentMdxComponents,
  // Every fence in a language the platform runs becomes the read-only editor.
  // Registered HERE and not in `content/`: the mapping needs the editor, and
  // `content → components` is not an allowed edge — composing the map in the
  // shell is the seam that already exists for exactly this (ADR-0003/0010).
  pre: MdxPre,
  Slide,
  SectionBreak,
  SideBySide,
  PresentationWide,
  Split,
  Mosaic,
  Figure,
  // Not lazy: a pure SVG with no package of its own, and 162 figures on one
  // page would each paint a placeholder first. Measured on the shipped build
  // (#322 review, removing it from this map AND from the components barrel,
  // whose re-export alone keeps it in the entry chunk; vite build on the
  // tree of 112bc4b, the figure's last change): it costs the entry chunk
  // 14,710 bytes raw, 4,525 with gzip -9 — code that used to travel inside
  // the two tree documents.
  // A lazy wrapper would also hide its authoring errors from
  // app/contentRenders.test.tsx (apps/web/CLAUDE.md, class 4).
  BinaryPicture,
  // Not lazy, for BinaryPicture's reasons, and smaller: two figures promoted
  // from Árboles I when Árboles II wanted them (#322, the counterexamples to
  // a tree's invariants and the rule of a traversal). Measured on the
  // shipped build the same way, on the same tree, the two cost the entry
  // chunk 2,846 bytes raw, 878 with gzip -9. #356 made NodeGraph the Grafos
  // unit's drawing (arrows, weights, parallel edges, notes, pills, and its
  // geometry in components/nodeGraphLayout.ts): main against #356's S2
  // commit, the entry chunk grew 3,834 bytes raw, 1,405 with gzip -9.
  NodeGraph,
  OrderRule,
  // Not lazy, for BinaryPicture's reasons: two figures promoted from Tablas
  // Hash when Set y Map wanted them (#353), pure SVG with no package of their
  // own — the steps from a key to its position, and the chain table both hash
  // classes drew with a copy of their own. Measured on the shipped build the
  // same way, on the tree of a5f5e40 (the figures' last code change), the two
  // cost the entry chunk 8,238 bytes raw and 2,257 with gzip -9 — the gzip
  // figure moves by a few bytes with the hashed names of the chunks the entry
  // imports.
  StepBoxes,
  ChainTable,
  // Not lazy: it is one iframe. Measured on the shipped build, registering it
  // eagerly costs the entry chunk 1,463 bytes of component code, and it pulls in
  // no package the first paint did not already need. (That figure used to be
  // quoted as +5.6kB raw, the rest being its catalog prose, which travelled
  // eagerly for every component, lazy or not. #122 moved the entries behind a
  // dynamic import, so the prose no longer ships here — only the component code
  // does.)
  //
  // Do NOT read that as "the sheet is free until someone scrolls to it": the
  // frame carries `loading="lazy"`, and lazy on an iframe was measured to defer
  // nothing until roughly 4000px below the fold in Chromium. On both pages that
  // ship one today the frame is above that, so Google's ~570kB first-visit
  // weight lands with the page. The attribute stays because it costs nothing
  // and pays off the day a frame sits at the foot of a long document.
  SheetEmbed,
  // Not lazy: it is one iframe pointing at Drive's viewer. Same shape as
  // SheetEmbed, but with allow-same-origin, which Drive's viewer was measured
  // to need (see PdfEmbed.tsx, ADR-0076).
  PdfEmbed,
  // Not lazy: it is one iframe pointing at YouTube. Same shape as SheetEmbed,
  // but framed with no sandbox at all — YouTube's player breaks under one (see
  // VideoEmbed.tsx).
  VideoEmbed,
  // The lazy wrapper, not the editor itself: this map is evaluated eagerly, and
  // registering the real component would put CodeMirror in the entry chunk.
  CodeEditor: LazyCodeEditor,
  Exercise: LazyExercise,
  PredictOutput: LazyPredictOutput,
  // Same lazy rule, both routes: <Benchmark> wraps LazyCodeEditor AND imports
  // the runtime seam through `useLoadedRuntime`, so registering the real one
  // here would put CodeMirror and CheerpJ back in the entry chunk of every
  // reader of every page. ADR-0044 documents the widget; the guard is
  // `apps/web/src/architecture.test.ts` per-name case for `benchmark`.
  Benchmark: LazyBenchmark,
  // Lazy for pattern consistency and the CodeMirror-gutter future extension
  // the ADR anticipates (ADR-0045).
  ComplexityCounter: LazyComplexityCounter,
  // Same lazy rule: composes <CodeStepper> + <ComplexityCounter>, so both
  // CodeMirror and the counter chunk stay off the entry chunk of readers who
  // never mount an exercise. Guarded by architecture.test.ts.
  ComplexityExercise: LazyComplexityExercise,
  // Concentric-rings visualization of `O(1) ⊂ ··· ⊂ O(2ᴺ)`. Lazy for
  // pattern consistency with the other interactive widgets. Guarded by
  // architecture.test.ts.
  ComplexityHierarchy: LazyComplexityHierarchy,
  // Nivo (@nivo/line) is a chart library that pulls its own React tree +
  // a slice of d3 for scales / shapes / interpolation; lazy keeps it out
  // of the entry chunk (ADR-0046). Guarded by architecture.test.ts.
  MathPlot: LazyMathPlot,
  // Same lazy rule, for the same entry-chunk reason (ADR-0040): the mermaid
  // library adds ~200kB gzipped of mermaid-only chunks (measured, ADR-0040
  // §Consequences) and must only load on pages that mount a
  // diagram.
  Mermaid: LazyMermaid,
  // Not lazy: a question renders text and buttons. The editor it may embed is
  // itself lazy, so a document with no code question pulls no CodeMirror.
  Questions,
  Question,
  // Pedagogical note attached to a `<Question>` — page-only, unwrapped by the
  // parent's `parseQuestionParts` and rendered inline after the reader
  // answers. Never travels to `questions.json` (source parser drops the
  // block; see `Explanation.tsx`).
  Explanation,
  // Not lazy: draws a small SVG-free tree with lucide chevrons and inline
  // styles for the per-argument hue (theme-aware via useResolvedTheme, no raw
  // Tailwind colour class — design-system.md §Adding a token would be the
  // alternative and buys nothing scoped to one component). No CodeMirror, no
  // runtime seam: the eager-graph walk in architecture.test.ts stays happy.
  RecursionTree,
  // Same exemption and the same lightness: an SVG of rects, a per-layer hue
  // through useResolvedTheme, and a timer (#357, the paint bucket by layers).
  FloodFill,
  // Same shape family as RecursionTree — SVG-free chips with pseudo-element
  // connector lines, no CodeMirror, no runtime seam. Each chip has two rows
  // (call args on top, return value on bottom). Two recipes: `max` (binary
  // tree) and `binary-search` (linear chain). ADR-0063; ADR-0064 amends it
  // with `mergesort`/`quicksort` recipes and the `highlightNode` +
  // `nodeAnnotations` hooks the sort-stepper composes.
  DivideCombineTree,
  // Same shape family — SVG-free chips with pseudo-element connector lines,
  // no CodeMirror, no runtime seam. One interactive toggle ("Mostrar peor
  // caso"). ADR-0066.
  DecisionTreeSort,
  // Lazy: composes <CodeStepper> (CodeMirror + java grammar) plus
  // <DivideCombineTree> for merge/quick. Registering the real component here
  // would put CodeMirror in the entry chunk of every reader. Guarded by
  // architecture.test.ts. ADR-0065.
  SortStepper: LazySortStepper,
  // Lazy: composes <CodeStepper> (CodeMirror + java grammar). The axis widget
  // of the linked-list class — one widget whose `eda` prop picks the structure
  // and whose `operation` prop picks the animation. Guarded by
  // architecture.test.ts. ADR-0074.
  SequenceStepper: LazySequenceStepper,
  // Lazy: composes <StepShow> (which composes <CodeStepper> → CodeMirror).
  // Same reason as SortStepper for lazyness. Teaches the `merge` operation
  // in isolation before mergesort's recursion.
  MergeStepper: LazyMergeStepper,
  // Lazy: same reason as MergeStepper. Teaches the Lomuto `partition`
  // operation in isolation before quicksort's recursion. Uses the shared
  // lomutoPartition so both widgets agree on behaviour.
  PartitionStepper: LazyPartitionStepper,
  // Lazy: composes <CodeStepper> (CodeMirror + java grammar) plus lucide
  // icons for its controls. Registering the real component here would put
  // CodeMirror in the entry chunk of every reader. Guarded by
  // architecture.test.ts. ADR-0059.
  BinarySearchOnArray: LazyBinarySearchOnArray,
  // Same lazy rule (composes <CodeStepper>). Traces the FULL D&C recursion —
  // enter/return/cross-scan/winner — with a breadcrumb of the call path.
  // ADR-0060.
  MaxSubarrayViz: LazyMaxSubarrayViz,
  // Same lazy rule (composes <CodeStepper>). Geometric D&C on a 2D plane —
  // division line, strip of width d, 7-position sweep visible. ADR-0061.
  ClosestPairViz: LazyClosestPairViz,
  // Same lazy rule (composes <CodeStepper>). Algebraic reveal of the Karatsuba
  // trick that turns 4 sub-multiplications into 3. ADR-0062.
  KaratsubaViz: LazyKaratsubaViz,
  // Lazy: composes <CodeStepper> (CodeMirror + java grammar) and lucide
  // icons for its controls. Registering the real one here would put
  // CodeMirror in the entry chunk of every reader. Guarded by
  // architecture.test.ts. ADR-0054.
  CallStack: LazyCallStack,
  // Lazy for pattern consistency; the tower/disc widget is lightweight but
  // the boundary is uniform across interactive widgets. Guarded by
  // architecture.test.ts. ADR-0055.
  HanoiPlayground: LazyHanoiPlayground,
  PenTrace: LazyPenTrace,
  // The lazy wrapper, not the widget itself: `<StepShow>` mounts a
  // `<CodeStepper>` that uses CodeMirror + `useGrammar` for the same syntax
  // highlighting every other `java` fence gets on the site. Registering the
  // real component here would put CodeMirror in the entry chunk of every
  // reader of every page — same reason `LazyCodeEditor` / `LazyExercise` /
  // `LazyPredictOutput` are lazy. `<Step>` stays eager (returns null, no
  // dependencies); the `child.type === Step` identity check inside StepShow
  // reads THIS reference.
  // Lazy: a listing quoted from a file beside the document (ADR-0091); mounts
  // <CodeStepper> → CodeMirror and carries the course's source files.
  SourceFile: LazySourceFile,
  StepShow: LazyStepShow,
  Step,
  // Lazy: composes <StepShow> (which itself pulls CodeStepper /
  // CodeMirror + java grammar the first time it renders). Documents
  // that never touch fib memoization must not pay for it in their
  // entry chunk. Guarded by architecture.test.ts.
  FibMemoSteps: LazyFibMemoSteps,
  // Lazy for the same reason as FibMemoSteps.
  FibTabSteps: LazyFibTabSteps,
  // Lazy for the same reason as FibMemoSteps.
  FibIterSteps: LazyFibIterSteps,
  // Lazy for the same reason as FibMemoSteps: a walk over a graph played by
  // <StepShow> (ADR-0092).
  GraphWalk: LazyGraphWalk,
  // Not lazy at the wrapper level, but the component internally
  // Suspense-loads KaTeX (~260 kB) via `React.lazy`. So the entry chunk
  // pays for the Math shell (Suspense + a few lines of JSX); only pages
  // that actually mount a <Math> pull the KaTeX chunk. Guarded by
  // architecture.test.ts (the katex ban).
  //
  // Exported name is `MathTex` (avoids shadowing the JS global `Math`
  // in TypeScript modules) and re-aliased here as `Math` for MDX
  // authors — the short name in course prose, the safe name in code.
  Math: MathTex,
  // Not lazy: takes typed state, calls the pure `memoryLayout` algorithm and
  // paints SVG. No runtime seam, no CheerpJ, no CodeMirror — the whole reversal
  // #209 buys is that this component's cost is its own tiny chunk and nothing
  // else. Guarded structurally: adding a static import of `runtime/` from
  // MemoryVisual.tsx would fail the eager-graph walk in architecture.test.ts.
  MemoryVisual,
};
