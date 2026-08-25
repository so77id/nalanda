/**
 * Static metadata attached to component functions so features can recognize
 * elements by role WITHOUT importing each other's components (no feature
 * cycles: consumers import only lib/).
 */
export interface ComponentMeta {
  /** Heading level rendered by this component (set by the MDX heading factory). */
  headingLevel?: 1 | 2 | 3 | 4;
  /** This component marks a slide boundary in presentation mode. */
  slideBoundary?: 'slide' | 'section-break';
  /**
   * This component participates in the question subsystem:
   * - `'group'`: the wrapper around a set of questions (`<Questions>`).
   * - `'question'`: a single control question (`<Question>`).
   * - `'explanation'`: a pedagogical note attached to a question — page-only,
   *   never exported to `questions.json` (see `Explanation.tsx`).
   */
  questionRole?: 'group' | 'question' | 'explanation';
}

/** Attaches meta to a component and returns it (typed passthrough). */
export function withMeta<C>(component: C, meta: ComponentMeta): C {
  return Object.assign(component as object, { componentMeta: meta }) as C;
}

/** Reads the meta of a React element type; empty object for plain tags/unknown. */
export function metaOf(type: unknown): ComponentMeta {
  if (typeof type !== 'function') return {};
  return (type as { componentMeta?: ComponentMeta }).componentMeta ?? {};
}
