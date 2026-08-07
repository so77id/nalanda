import type { CatalogFamily } from '../lib/catalogEntry';

export interface FamilyDef {
  id: CatalogFamily;
  /** Display name (family ids stay kebab-safe for routes). */
  name: string;
  definition: string;
  whatBelongs: string;
}

/** The four editable families (ADR-0010). Order is display order. */
export const families: FamilyDef[] = [
  {
    id: 'estructura',
    name: 'Estructura',
    definition: 'Components that shape how a document flows and breaks into slides.',
    whatBelongs:
      'Anything that organizes content without being content itself: slide boundaries, section breaks, future layout blocks.',
  },
  {
    id: 'semanticos',
    name: 'Semánticos',
    definition: 'Components that mark what a piece of content MEANS.',
    whatBelongs:
      'Definitions, theorems, warnings, key ideas — semantic wrappers that style and index meaning, not behavior.',
  },
  {
    id: 'interactivos',
    name: 'Interactivos',
    definition: 'Components the student operates: they hold state and respond.',
    whatBelongs:
      'Visualizers, code editors, quizzes, steppers — anything with client-side behavior (ADR-0001).',
  },
  {
    id: 'media',
    name: 'Media',
    definition: 'Components that embed external or heavy media.',
    whatBelongs: 'Images with behavior, video, audio, embeds — media beyond plain Markdown.',
  },
];
