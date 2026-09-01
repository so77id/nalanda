// Public seam of the components feature (import direction rule, frontend-code-style.md).
import type { CatalogEntry } from '../lib/catalogEntry';

// Documents and the catalog both get the lazy wrapper — nothing outside
// `interactive/lazyCodeEditor.tsx` may name the editor module, or CodeMirror
// returns to the entry chunk (guarded in src/architecture.test.ts).
export { LazyCodeEditor } from './interactive/lazyCodeEditor';
// Same rule, same reason: Exercise embeds CodeMirror too.
export { LazyExercise } from './interactive/lazyExercise';
// Same rule, both routes: PredictOutput wraps LazyCodeEditor AND imports the
// runtime seam through `useLoadedRuntime`.
export { LazyPredictOutput } from './interactive/lazyPredictOutput';
// Same rule, same two routes as PredictOutput: <Benchmark> wraps
// LazyCodeEditor and drives the runtime through `useLoadedRuntime` (ADR-0044).
export { LazyBenchmark } from './interactive/lazyBenchmark';
// Lazy: composes <CodeStepper> (CodeMirror + java grammar) and lucide icons
// for the playback controls. Registering the real one here would put
// CodeMirror in the entry chunk of every reader (ADR-0054). Guarded by
// `src/architecture.test.ts` (per-name `callstack`).
export { LazyCallStack } from './interactive/lazyCallStack';
// Lazy for pattern consistency: HanoiPlayground carries lucide icons and
// the tower/disc animation glue. Guarded by `src/architecture.test.ts`
// (per-name `hanoiplayground`). ADR-0055.
export { LazyHanoiPlayground } from './interactive/lazyHanoiPlayground';
// Lazy for pattern consistency and for the CodeMirror-gutter future
// extension the ADR anticipates (ADR-0045).
export { LazyComplexityCounter } from './interactive/lazyComplexityCounter';
// Lazy on the same rule: <ComplexityExercise> composes <CodeStepper> +
// <ComplexityCounter>, both CodeMirror-adjacent, and registering it eagerly
// would pull the editor back into the entry chunk. Guarded by
// `src/architecture.test.ts` (per-name `complexityexercise`).
export { LazyComplexityExercise } from './interactive/lazyComplexityExercise';
// Lazy for pattern consistency with the other interactive widgets. Carries
// no CodeMirror weight, only React + SVG — the eager-graph rule is uniform
// so the seam stays predictable, and the guard in `src/architecture.test.ts`
// (per-name `complexityhierarchy`) keeps future extensions inside the
// wrapper.
export { LazyComplexityHierarchy } from './interactive/lazyComplexityHierarchy';
// Nivo (@nivo/line) is a chart library that pulls its own React tree and
// a slice of d3 (scales, shapes, interpolation) — the lazy wrapper is what
// keeps Nivo out of the entry chunk of every reader of every page (ADR-0046).
export { LazyMathPlot } from './interactive/lazyMathPlot';
// Same rule, heaviest instance: mermaid reaches dagre/d3/parsers (~200kB
// gzipped of mermaid-only chunks, measured — ADR-0040 §Consequences).
export { LazyMermaid } from './interactive/lazyMermaid';
// Not a document-facing component and deliberately not in the catalog: authors
// never write it, they write a fence. The shell maps it onto `pre`.
export { MdxPre } from './MdxPre';
export { Figure } from './media/Figure';
export { MathTex } from './media/Math';
export type { MathTexProps } from './media/Math';
export { SheetEmbed } from './media/SheetEmbed';
export { VideoEmbed } from './media/VideoEmbed';
export { Explanation } from './interactive/Explanation';
export { Question } from './interactive/Question';
export { Questions } from './interactive/Questions';
export { RecursionTree } from './interactive/RecursionTree';
export { DivideCombineTree } from './interactive/DivideCombineTree';
// The lazy wrapper, not the widget itself: <BinarySearchOnArray> composes
// <CodeStepper> (CodeMirror + java grammar), and the MDX map is evaluated
// eagerly. Registering the real component here would put CodeMirror in the
// entry chunk of every reader of every page (guarded in
// `src/architecture.test.ts`). ADR-0059.
export { LazyBinarySearchOnArray } from './interactive/lazyBinarySearchOnArray';
// Lazy for the same reason: composes <CodeStepper> (CodeMirror). ADR-0060,
// guarded per-name in `src/architecture.test.ts`.
export { LazyMaxSubarrayViz } from './interactive/lazyMaxSubarrayViz';
// Lazy for the same reason: composes <CodeStepper> (CodeMirror). ADR-0061,
// guarded per-name in `src/architecture.test.ts`.
export { LazyClosestPairViz } from './interactive/lazyClosestPairViz';
// Lazy for the same reason: composes <CodeStepper> (CodeMirror). ADR-0062,
// guarded per-name in `src/architecture.test.ts`.
export { LazyKaratsubaViz } from './interactive/lazyKaratsubaViz';
// The lazy wrapper, not the widget itself: `<CodeStepper>` inside `<StepShow>`
// imports CodeMirror + `useGrammar`, and the MDX map is evaluated eagerly.
// Registering the real component here would put CodeMirror in the entry chunk
// of every reader of every page (guarded in `src/architecture.test.ts`). The
// `StepShowProps` type lives on the lazy wrapper too, so a consumer importing
// it does not statically pull the real widget into their graph.
export { LazyStepShow } from './interactive/lazyStepShow';
export type { StepShowProps } from './interactive/lazyStepShow';
// The marker child stays eager: it returns null and imports nothing heavy. The
// `child.type === Step` identity check in `<StepShow>` reads THIS export.
export { Step } from './interactive/Step';
export type { StepProps } from './interactive/Step';
// Lazy for the same reason as LazyStepShow: these widgets compose it
// internally, so they inherit the CodeMirror dependency the first time
// they render. Documents that never touch fib memoization must not pay
// for it in their entry chunk.
export { LazyFibMemoSteps } from './interactive/lazyFibMemoSteps';
export type { FibMemoStepsProps } from './interactive/lazyFibMemoSteps';
export { LazyFibTabSteps } from './interactive/lazyFibTabSteps';
export type { FibTabStepsProps } from './interactive/lazyFibTabSteps';
export { LazyFibIterSteps } from './interactive/lazyFibIterSteps';
export type { FibIterStepsProps } from './interactive/lazyFibIterSteps';
export { MemoryVisual } from './interactive/MemoryVisual';
export type {
  MemoryFrame,
  MemoryObject,
  MemorySlot,
  MemoryState,
  MemoryValue,
} from './interactive/memoryModel';
export { Mosaic } from './structure/Mosaic';
export { SectionBreak } from './structure/SectionBreak';
export { SideBySide } from './structure/SideBySide';
export { Slide } from './structure/Slide';
export { Split } from './structure/Split';

/**
 * Every catalog entry this feature ships (colocated *.catalog.tsx files), behind
 * a dynamic import.
 *
 * A FUNCTION rather than the array itself, and that is the whole mechanism: the
 * shell reaches this seam eagerly for the MDX map, so a static `export {
 * catalogEntries }` here — even re-exported from another module — puts every
 * entry's prose in the payload of every course page. The `import()` is the cut,
 * and `src/architecture.test.ts` walks the eager graph to prove it holds. Only
 * `/catalog` calls this.
 */
export async function loadCatalogEntries(): Promise<CatalogEntry[]> {
  return (await import('./catalogEntries')).catalogEntries;
}
