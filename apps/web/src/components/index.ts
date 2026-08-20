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
// Same rule, heaviest instance: mermaid reaches dagre/d3/parsers (~200kB
// gzipped of mermaid-only chunks, measured — ADR-0040 §Consequences).
export { LazyMermaid } from './interactive/lazyMermaid';
// Not a document-facing component and deliberately not in the catalog: authors
// never write it, they write a fence. The shell maps it onto `pre`.
export { MdxPre } from './MdxPre';
export { Figure } from './media/Figure';
export { SheetEmbed } from './media/SheetEmbed';
export { Question } from './interactive/Question';
export { Questions } from './interactive/Questions';
export { RecursionTree } from './interactive/RecursionTree';
export { Step, StepShow } from './interactive/StepShow';
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
