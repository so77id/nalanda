// Public seam of the components feature (import direction rule, frontend-code-style.md).
import type { CatalogEntry } from '../lib/catalogEntry';

import { codeEditorCatalogEntry } from './interactive/CodeEditor.catalog';
import { exerciseCatalogEntry } from './interactive/Exercise.catalog';
import { memoryDiagramCatalogEntry } from './interactive/MemoryDiagram.catalog';
import { figureCatalogEntry } from './media/Figure.catalog';
import { mosaicCatalogEntry } from './structure/Mosaic.catalog';
import { sectionBreakCatalogEntry } from './structure/SectionBreak.catalog';
import { sideBySideCatalogEntry } from './structure/SideBySide.catalog';
import { slideCatalogEntry } from './structure/Slide.catalog';
import { splitCatalogEntry } from './structure/Split.catalog';

// Documents and the catalog both get the lazy wrapper — nothing outside
// `interactive/lazyCodeEditor.tsx` may name the editor module, or CodeMirror
// returns to the entry chunk (guarded in src/architecture.test.ts).
export { LazyCodeEditor } from './interactive/lazyCodeEditor';
// Same rule, same reason: Exercise embeds CodeMirror too.
export { LazyExercise } from './interactive/lazyExercise';
// Same rule again, reached differently: MemoryDiagram imports the runtime seam.
export { LazyMemoryDiagram } from './interactive/lazyMemoryDiagram';
// Not a document-facing component and deliberately not in the catalog: authors
// never write it, they write a fence. The shell maps it onto `pre`.
export { MdxPre } from './MdxPre';
export { Figure } from './media/Figure';
export { Mosaic } from './structure/Mosaic';
export { SectionBreak } from './structure/SectionBreak';
export { SideBySide } from './structure/SideBySide';
export { Slide } from './structure/Slide';
export { Split } from './structure/Split';

/** Every catalog entry this feature ships (colocated *.catalog.tsx files). */
export const catalogEntries: CatalogEntry[] = [
  slideCatalogEntry,
  sectionBreakCatalogEntry,
  sideBySideCatalogEntry,
  splitCatalogEntry,
  mosaicCatalogEntry,
  figureCatalogEntry,
  codeEditorCatalogEntry,
  exerciseCatalogEntry,
  memoryDiagramCatalogEntry,
];
