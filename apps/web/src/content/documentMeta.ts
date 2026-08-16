import { parse } from 'yaml';

/** Frontmatter contract every content document must satisfy (issue #63, ADR-0002). */
export interface DocumentMeta {
  id: string;
  title: string;
  /** How the document presents (issue #64): auto = h2 slicing, explicit = only marked slides, none = book-only. */
  presentation: 'auto' | 'explicit' | 'none';
  /**
   * How the document is covered by control questions (issue #139):
   * per-section = every section should carry one, gaps declared as exceptions;
   * pool = a set of questions with no per-section expectation;
   * none = deliberately without.
   *
   * The point of the field is to force a DECISION. A rule demanding one
   * question per section instead produces filler for transition slides and
   * code listings, and filler measures noise and then lands in a real control.
   */
  questions: 'per-section' | 'pool' | 'none';
}

const PRESENTATION_VALUES = ['auto', 'explicit', 'none'] as const;
type Presentation = (typeof PRESENTATION_VALUES)[number];

const QUESTIONS_VALUES = ['per-section', 'pool', 'none'] as const;
type Questions = (typeof QUESTIONS_VALUES)[number];

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Extracts and parses the YAML frontmatter block of raw MDX source; null when absent. */
export function parseFrontmatterBlock(raw: string): unknown {
  const match = FRONTMATTER_BLOCK.exec(raw);
  if (!match || match[1] === undefined) return null;
  return parse(match[1]);
}

/** Validates parsed frontmatter into a DocumentMeta; throws with the source path on any violation. */
export function parseDocumentMeta(sourcePath: string, raw: unknown): DocumentMeta {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Content registry: no frontmatter found in ${sourcePath}`);
  }
  const { id, title, presentation, questions } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`Content registry: missing frontmatter "id" in ${sourcePath}`);
  }
  if (!KEBAB_CASE.test(id)) {
    throw new Error(
      `Content registry: id "${id}" is not kebab-case (lowercase words separated by "-") in ${sourcePath}`,
    );
  }
  if (typeof title !== 'string' || title === '') {
    throw new Error(`Content registry: missing frontmatter "title" in ${sourcePath}`);
  }
  if (
    presentation !== undefined &&
    !(PRESENTATION_VALUES as readonly unknown[]).includes(presentation)
  ) {
    throw new Error(
      `Content registry: "presentation" must be one of ${PRESENTATION_VALUES.join(', ')} in ${sourcePath}`,
    );
  }
  if (questions !== undefined && !(QUESTIONS_VALUES as readonly unknown[]).includes(questions)) {
    throw new Error(
      `Content registry: "questions" must be one of ${QUESTIONS_VALUES.join(', ')} in ${sourcePath}`,
    );
  }
  return {
    id,
    title,
    presentation: (presentation as Presentation | undefined) ?? 'auto',
    // Defaults to `none` rather than `per-section`: an absent field means the
    // author has not decided, and the safe reading of that is "no questions
    // yet", not "this document owes one per section". Nothing should rely on
    // the default — the suite requires every document to declare it, the same
    // way #108 requires `presentation`.
    questions: (questions as Questions | undefined) ?? 'none',
  };
}
