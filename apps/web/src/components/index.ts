// Public seam of the components feature (import direction rule, frontend-code-style.md).
import type { CatalogEntry } from '../lib/catalogEntry';

import { sectionBreakCatalogEntry } from './structure/SectionBreak.catalog';
import { slideCatalogEntry } from './structure/Slide.catalog';

export { SectionBreak } from './structure/SectionBreak';
export { Slide } from './structure/Slide';

/** Every catalog entry this feature ships (colocated *.catalog.tsx files). */
export const catalogEntries: CatalogEntry[] = [slideCatalogEntry, sectionBreakCatalogEntry];
