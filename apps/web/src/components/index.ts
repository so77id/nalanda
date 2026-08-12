// Public seam of the components feature (import direction rule, frontend-code-style.md).
import type { CatalogEntry } from '../lib/catalogEntry';

import { codeEditorCatalogEntry } from './interactive/CodeEditor.catalog';
import { exerciseCatalogEntry } from './interactive/Exercise.catalog';
import { sectionBreakCatalogEntry } from './structure/SectionBreak.catalog';
import { slideCatalogEntry } from './structure/Slide.catalog';

// Documents and the catalog both get the lazy wrapper — nothing outside
// `interactive/lazyCodeEditor.tsx` may name the editor module, or CodeMirror
// returns to the entry chunk (guarded in src/architecture.test.ts).
export { LazyCodeEditor } from './interactive/lazyCodeEditor';
// Same rule, same reason: Exercise embeds CodeMirror too.
export { LazyExercise } from './interactive/lazyExercise';
export { SectionBreak } from './structure/SectionBreak';
export { Slide } from './structure/Slide';

/** Every catalog entry this feature ships (colocated *.catalog.tsx files). */
export const catalogEntries: CatalogEntry[] = [
  slideCatalogEntry,
  sectionBreakCatalogEntry,
  codeEditorCatalogEntry,
  exerciseCatalogEntry,
];
