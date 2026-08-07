import type { ReactNode } from 'react';

/** Concatenated text content of a node tree (elements contribute nothing themselves). */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}
