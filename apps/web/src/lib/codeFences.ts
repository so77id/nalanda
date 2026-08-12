import { Children, Fragment, isValidElement, type ReactNode } from 'react';

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

/**
 * The same children with every labelled fence removed — what is left is the
 * prose.
 *
 * A component that reads its fences as data must not also render them: the
 * starter code belongs in an editor and the test cases stay hidden until the
 * student runs, so leaving them in the flow would show both twice and spoil the
 * second.
 */
export function withoutFences(children: ReactNode): ReactNode[] {
  // Fragments are flattened first, and deliberately: `Children.toArray` treats
  // one as a single child, so a fragment holding both the prose and the fences
  // would be dropped whole and the statement would vanish with them.
  const flat: ReactNode[] = [];
  const flatten = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      for (const child of node as ReactNode[]) flatten(child);
      return;
    }
    if (isValidElement(node) && node.type === Fragment) {
      flatten((node.props as { children?: ReactNode }).children);
      return;
    }
    flat.push(node);
  };
  flatten(children);

  return Children.toArray(flat).filter((child) => Object.keys(fencesByMeta(child)).length === 0);
}
