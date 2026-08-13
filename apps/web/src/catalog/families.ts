import type { CatalogFamily } from '../lib/catalogEntry';

export interface FamilyDef {
  /**
   * Route segment AND the src/components/ folder the family's components live
   * in — one word, not two fields. A stored `folder` was duplicated state that
   * could drift from the id it must equal (#87).
   */
  id: CatalogFamily;
  /** The id capitalized — derived, for the same reason `folder` was deleted. */
  name: string;
  definition: string;
  whatBelongs: string;
}

// Record (not an array) so adding a CatalogFamily member without its definition
// fails to compile — the family taxonomy cannot drift from its presentation.
const definitions: Record<CatalogFamily, Omit<FamilyDef, 'id' | 'name'>> = {
  structure: {
    definition: 'Components that shape how a document flows and breaks into slides.',
    whatBelongs:
      'Anything that organizes content without being content itself: slide boundaries, section breaks, future layout blocks.',
  },
  semantic: {
    definition: 'Components that mark what a piece of content MEANS.',
    whatBelongs:
      'Definitions, theorems, warnings, key ideas — semantic wrappers that style and index meaning, not behavior.',
  },
  interactive: {
    definition: 'Components the student operates: they hold state and respond.',
    whatBelongs:
      'Visualizers, code editors, quizzes, steppers — anything with client-side behavior (ADR-0001).',
  },
  media: {
    definition: 'Components that embed external or heavy media.',
    whatBelongs: 'Images with behavior, video, audio, embeds — media beyond plain Markdown.',
  },
};

/**
 * How a family id is written for a reader. Derived rather than stored: the four
 * names were literally the four ids capitalized, which is the same duplicated
 * state `folder` was deleted for, one field lower and equally unenforced (#87).
 * A name that must one day diverge from its id — "Media & embeds" — brings the
 * field back deliberately, rather than inheriting it by accident.
 */
export function familyName(id: CatalogFamily): string {
  return id[0].toUpperCase() + id.slice(1);
}

/**
 * Why a family can be empty. Two of the four are, and that is policy, not a
 * gap: components are built when a class asks for one (ADR-0010, §Inventory is
 * emergent). Said on both surfaces that can show an empty family, so neither
 * reads as broken — and because this is the page an agent consults before
 * inventing a component, where silence next to "no components" reads as an
 * invitation.
 */
export const EMPTY_FAMILY_REASON = 'components are built when a class needs one, not in advance';

/** The four families in display order (ADR-0010). */
export const families: FamilyDef[] = (Object.keys(definitions) as CatalogFamily[]).map((id) => ({
  id,
  name: familyName(id),
  ...definitions[id],
}));
