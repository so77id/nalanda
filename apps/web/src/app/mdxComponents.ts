import {
  Explanation,
  Figure,
  LazyBenchmark,
  LazyCallStack,
  LazyCodeEditor,
  LazyHanoiPlayground,
  LazyComplexityCounter,
  LazyComplexityExercise,
  LazyComplexityHierarchy,
  LazyMathPlot,
  LazyExercise,
  LazyFibIterSteps,
  LazyFibMemoSteps,
  LazyFibTabSteps,
  LazyMermaid,
  LazyPredictOutput,
  LazyStepShow,
  Math,
  MdxPre,
  MemoryVisual,
  Mosaic,
  Question,
  Questions,
  RecursionTree,
  SectionBreak,
  SheetEmbed,
  SideBySide,
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
  Split,
  Mosaic,
  Figure,
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
  // Not lazy: it is one iframe pointing at YouTube. Same shape as SheetEmbed.
  // See VideoEmbed.tsx for the sandbox rationale (allow-same-origin is
  // required for YouTube, deliberately absent from SheetEmbed).
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
  // Lazy: composes <CodeStepper> (CodeMirror + java grammar) and lucide
  // icons for its controls. Registering the real one here would put
  // CodeMirror in the entry chunk of every reader. Guarded by
  // architecture.test.ts. ADR-0049.
  CallStack: LazyCallStack,
  // Lazy for pattern consistency; the tower/disc widget is lightweight but
  // the boundary is uniform across interactive widgets. Guarded by
  // architecture.test.ts. ADR-0050.
  HanoiPlayground: LazyHanoiPlayground,
  // The lazy wrapper, not the widget itself: `<StepShow>` mounts a
  // `<CodeStepper>` that uses CodeMirror + `useGrammar` for the same syntax
  // highlighting every other `java` fence gets on the site. Registering the
  // real component here would put CodeMirror in the entry chunk of every
  // reader of every page — same reason `LazyCodeEditor` / `LazyExercise` /
  // `LazyPredictOutput` are lazy. `<Step>` stays eager (returns null, no
  // dependencies); the `child.type === Step` identity check inside StepShow
  // reads THIS reference.
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
  // Not lazy at the wrapper level, but the component internally
  // Suspense-loads KaTeX (~260 kB) via `React.lazy`. So the entry chunk
  // pays for the Math shell (Suspense + a few lines of JSX); only pages
  // that actually mount a <Math> pull the KaTeX chunk. Guarded by
  // architecture.test.ts (the katex ban).
  Math,
  // Not lazy: takes typed state, calls the pure `memoryLayout` algorithm and
  // paints SVG. No runtime seam, no CheerpJ, no CodeMirror — the whole reversal
  // #209 buys is that this component's cost is its own tiny chunk and nothing
  // else. Guarded structurally: adding a static import of `runtime/` from
  // MemoryVisual.tsx would fail the eager-graph walk in architecture.test.ts.
  MemoryVisual,
};
