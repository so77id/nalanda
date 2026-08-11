// Public seam of the components feature (import direction rule, frontend-code-style.md).
import type { CatalogEntry } from '../lib/catalogEntry';

import { codeEditorCatalogEntry } from './interactive/CodeEditor.catalog';
import { sectionBreakCatalogEntry } from './structure/SectionBreak.catalog';
import { slideCatalogEntry } from './structure/Slide.catalog';

export type { CodeEditorProps } from './interactive/CodeEditor';
// Documents get the lazy wrapper; the catalog imports the real one directly,
// since its pages are already a route-level chunk.
export { LazyCodeEditor } from './interactive/lazyCodeEditor';
export { SectionBreak } from './structure/SectionBreak';
export { Slide } from './structure/Slide';

/** Every catalog entry this feature ships (colocated *.catalog.tsx files). */
export const catalogEntries: CatalogEntry[] = [
  slideCatalogEntry,
  sectionBreakCatalogEntry,
  codeEditorCatalogEntry,
];
