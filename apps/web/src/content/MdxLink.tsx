import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

import { registry } from './liveContent';

const WIKI_PREFIX = 'wiki:';
// http(s), mailto, or local (path / fragment). Anything else (javascript:, data:) is refused.
const SAFE_HREF = /^(?:https?:|mailto:|[/.#])/i;
// Protocol-relative //host counts as external so it also gets the rel hardening.
const EXTERNAL_HREF = /^(?:https?:|mailto:|\/\/)/i;

const BROKEN_STYLE = 'cursor-not-allowed text-flag underline decoration-flag decoration-wavy';

// Render-path warnings repeat every re-render (twice under StrictMode) — warn once per target.
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

type Props = AnchorHTMLAttributes<HTMLAnchorElement>;

/**
 * Anchor renderer for MDX documents: resolves wiki: hrefs (emitted by
 * remarkWikiLinks) against the registry; unresolved ids and unsafe URL schemes
 * render visibly broken instead of linking.
 *
 * **The guard covers markdown, not literal JSX.** MDX passes markdown-generated
 * elements through the component map, so `[x](…)`, `[[wiki]]` and — since #83 —
 * GFM's bare-URL autolinks all arrive here and get the scheme check and the
 * `rel` hardening. An `<a>` written as literal JSX in a document does not: it
 * renders as authored, `rel` and all. That is accepted rather than fixed,
 * because everything under `content/` is reviewed in-repo material and MDX is
 * executable code regardless — but it means this component is not a sanitiser,
 * and nothing downstream should treat it as one.
 */
export function MdxLink({ href = '', children, ...rest }: Props) {
  if (href.startsWith(WIKI_PREFIX)) {
    const id = href.slice(WIKI_PREFIX.length);
    if (!registry.get(id)) {
      warnOnce(href, `Unresolved wiki-link [[${id}]] — no document with that id`);
      return <span className={BROKEN_STYLE}>{children}</span>;
    }
    return <Link to={`/d/${id}`}>{children}</Link>;
  }

  if (!SAFE_HREF.test(href)) {
    warnOnce(href, `Refused unsafe href "${href}" in document content`);
    return <span className={BROKEN_STYLE}>{children}</span>;
  }
  if (EXTERNAL_HREF.test(href)) {
    // rest spreads first so content JSX can never override the rel hardening.
    return (
      <a {...rest} href={href} rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <a {...rest} href={href}>
      {children}
    </a>
  );
}
