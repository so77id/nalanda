import { isValidElement, type ReactNode } from 'react';

import { textOf } from './reactText';

/**
 * The source of every fenced code block in `children`, keyed by its info-string
 * meta — the other half of `remarkCodeMeta`.
 *
 * A component whose body is authored as markdown receives it as rendered
 * elements, not as text, so telling one fence from another means walking them.
 * The meta is the only label available: ```` ```java starter ```` arrives as a
 * `<code>` carrying `data-meta="starter"`.
 *
 * Fences without meta are skipped, so ordinary code blocks inside the same body
 * keep rendering as code blocks. A repeated meta keeps the first occurrence.
 */
export function fencesByMeta(children: ReactNode): Record<string, string> {
  const found: Record<string, string> = {};

  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      for (const child of node as ReactNode[]) walk(child);
      return;
    }
    if (!isValidElement(node)) return;

    const props = node.props as { 'data-meta'?: unknown; children?: ReactNode };
    const meta = props['data-meta'];
    if (typeof meta === 'string') {
      found[meta] ??= textOf(props.children);
      return;
    }
    walk(props.children);
  };

  walk(children);
  return found;
}
