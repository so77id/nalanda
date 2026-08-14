import type { ReactNode } from 'react';

/**
 * Concatenated text content of a node tree (elements contribute nothing themselves).
 *
 * That last clause is load-bearing and costs something, since #118 (2026-08-14).
 * A heading whose content is entirely an element — a formula, `## $$\log_2 n$$` —
 * yields an empty string here, so `mdxHeading` produces no slug, no id, no
 * self-anchor and no entry in the section rail, silently and with a green suite.
 * The auto-mode slide-title path in `presentation/parser.ts` has the same hole.
 *
 * **Do not "fix" it by recursing into elements without a migration.** Recursing
 * changes slugs that are already published: `06-java-desde-cpp.mdx` has a heading
 * whose live anchor is `la-trampa-de-seguido-de` and would become
 * `la-trampa-de-nextint-seguido-de-nextline`. ADR-0027 records that a published
 * anchor is frozen, and why this was left alone.
 */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}
