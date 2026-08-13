import type { CatalogFamily } from '../lib/catalogEntry';

export interface FamilyDef {
  /**
   * Route segment AND the src/components/ folder the family's components live
   * in — one word, not two fields. A stored `folder` was duplicated state that
   * could drift from the id it must equal (#87).
   */
  id: CatalogFamily;
  /** Display name: the id, capitalized. */
  name: string;
  definition: string;
  whatBelongs: string;
}

// Record (not an array) so adding a CatalogFamily member without its definition
// fails to compile — the family taxonomy cannot drift from its presentation.
const definitions: Record<CatalogFamily, Omit<FamilyDef, 'id'>> = {
  structure: {
    name: 'Structure',
    definition: 'Components that shape how a document flows and breaks into slides.',
    whatBelongs:
      'Anything that organizes content without being content itself: slide boundaries, section breaks, future layout blocks.',
  },
  semantic: {
    name: 'Semantic',
    definition: 'Components that mark what a piece of content MEANS.',
    whatBelongs:
      'Definitions, theorems, warnings, key ideas — semantic wrappers that style and index meaning, not behavior.',
  },
  interactive: {
    name: 'Interactive',
    definition: 'Components the student operates: they hold state and respond.',
    whatBelongs:
      'Visualizers, code editors, quizzes, steppers — anything with client-side behavior (ADR-0001).',
  },
  media: {
    name: 'Media',
    definition: 'Components that embed external or heavy media.',
    whatBelongs: 'Images with behavior, video, audio, embeds — media beyond plain Markdown.',
  },
};

/** The four families in display order (ADR-0010). */
export const families: FamilyDef[] = (Object.keys(definitions) as CatalogFamily[]).map((id) => ({
  id,
  ...definitions[id],
}));
