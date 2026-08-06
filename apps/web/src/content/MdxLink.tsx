import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

import { registry } from './registry';

const WIKI_PREFIX = 'wiki:';

type Props = AnchorHTMLAttributes<HTMLAnchorElement>;

/**
 * Anchor renderer for MDX documents: resolves wiki: hrefs (emitted by
 * remarkWikiLinks) against the registry; unresolved ids render visibly broken.
 */
export function MdxLink({ href = '', children, ...rest }: Props) {
  if (!href.startsWith(WIKI_PREFIX)) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }

  const id = href.slice(WIKI_PREFIX.length);
  if (!registry.get(id)) {
    console.warn(`Unresolved wiki-link [[${id}]] — no document with that id`);
    return <span className="broken-link">{children}</span>;
  }
  return <Link to={`/d/${id}`}>{children}</Link>;
}
