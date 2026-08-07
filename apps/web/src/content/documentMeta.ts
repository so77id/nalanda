import { parse } from 'yaml';

/** Frontmatter contract every content document must satisfy (issue #63, ADR-0002). */
export interface DocumentMeta {
  id: string;
  title: string;
  /** How the document presents (issue #64): auto = h2 slicing, explicit = only marked slides, none = book-only. */
  presentation: 'auto' | 'explicit' | 'none';
}

const PRESENTATION_VALUES = ['auto', 'explicit', 'none'] as const;
type Presentation = (typeof PRESENTATION_VALUES)[number];

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
  const { id, title, presentation } = raw as Record<string, unknown>;
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
  return { id, title, presentation: (presentation as Presentation | undefined) ?? 'auto' };
}
