import { Children, Fragment, isValidElement } from 'react';
import type { ReactNode } from 'react';

/**
 * Unwraps the sibling list of a compiled MDX document.
 *
 * MDX v3 hands the layout wrapper ONE opaque element (_createMdxContent), not
 * the sibling array (that was MDX v1 behavior). That element's type is a plain
 * function component from our pinned toolchain whose only hook is
 * useMDXComponents (a useContext), so invoking it during OUR render keeps the
 * hook order legal — the caller must invoke this unconditionally, first thing
 * in render — and yields the sibling fragment the slide parser groups.
 *
 * If an MDX upgrade changes this compiled shape, the presentation route tests
 * fail here first; the recorded fallback (issue #64 discussion, option B) is
 * compile-time grouping via a remark plugin — swap this adapter, keep the
 * parser and viewer untouched.
 */
export function mdxChildrenOf(children: ReactNode): ReactNode {
  const element = Children.only(children);
  if (!isValidElement(element) || typeof element.type !== 'function') return children;
  const rendered = (element.type as (props: unknown) => ReactNode)(element.props);
  if (isValidElement(rendered) && rendered.type === Fragment) {
    return (rendered.props as { children?: ReactNode }).children;
  }
  return rendered;
}
