import { Presentation } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { withMeta } from '../lib/componentMeta';
import { usePresentableSections } from '../lib/presentableSections';
import { textOf } from '../lib/reactText';
import { slugify } from '../lib/slug';

interface HeadingProps {
  children?: ReactNode;
  /**
   * Raw source text to slug from, overriding what `textOf(children)` would
   * see. Used by `<Slide title="...">` when the children are the rendered
   * inline title tokens (spans, code, KaTeX HTML): `textOf` gets nothing
   * from those elements and would yield no slug, no id, no rail entry.
   * The Slide passes the raw title string as `slugSource` so the id matches
   * what `headingSlugs` reads from the mdx source — that agreement is what
   * `questionReaders.test.tsx > source reader and rendered reader agree`
   * pins.
   */
  slugSource?: string;
}

/**
 * Builds the heading renderer MDX uses for a given level: headings get a slug
 * id plus a sibling self-anchor marker, so any section of a document is
 * deep-linkable. The marker is a sibling (not a wrapper) so headings that
 * contain links never produce nested anchors.
 */
export function headingFor(level: 2 | 3 | 4) {
  const Tag = `h${level}` as const;
  function MdxHeading({ children, slugSource }: HeadingProps) {
    const text = slugSource ?? textOf(children);
    const slug = slugify(text);
    // Only h2 opens a slide (parser.ts); h3/h4 live INSIDE one. The button
    // reads context regardless — the value is the default silence on other
    // levels anyway — but only h2 asks whether to paint it.
    const { docId, presentableSlugs } = usePresentableSections();
    const canPresent = level === 2 && docId !== null && slug !== '' && presentableSlugs.has(slug);
    // No text to slug: render the heading, but with no id and no self-anchor.
    // Since #118 (2026-08-14) this is reachable from ordinary authoring — a
    // heading that is entirely a formula (`## $$\log_2 n$$`) has no text at all,
    // because `textOf` sees no strings — and it fails silently: no deep link, no
    // rail entry, green build, green suite. Contradicts ADR-0021 and ADR-0002
    // knowingly; the fix moves published slugs, so it needs its own migration
    // (ADR-0027 §8). The authoring guide tells authors to put text in a heading.
    // The present-section button rides the same fallback — no slug → no button.
    if (!slug) return <Tag>{children}</Tag>;
    return (
      <Tag id={slug} className="group scroll-mt-8">
        {children}
        <a
          href={`#${slug}`}
          aria-label={`Enlace a la sección «${text}»`}
          // slate-600 was 2.66:1 against the page, under the 3:1 floor. And it
          // revealed itself only to a pointer: focusable-and-transparent meant a
          // keyboard user landed on it with nothing to see, focus outline included.
          className="ml-2 text-ink-faint no-underline opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          #
        </a>
        {canPresent ? (
          // The book-side entry point (#256): a keyed sibling of the `#`
          // anchor with the same visibility rules (opacity 0 until hover or
          // focus). Renders a real navigation `<Link>` — the route changes —
          // rather than a button. `?section=<slug>` is the deep-link contract
          // SlideDeck resolves and canonicalizes to `?slide=<N>`. Painted
          // only when the surrounding document publishes this slug as
          // presentable (S4); catalog and non-slide h2s stay silent.
          <Link
            to={`/d/${docId}/present?section=${slug}`}
            aria-label={`Presentar la sección «${text}»`}
            className="ml-2 inline-flex items-center align-middle text-ink-faint no-underline opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Presentation size={16} aria-hidden="true" />
          </Link>
        ) : null}
      </Tag>
    );
  }
  return withMeta(MdxHeading, { headingLevel: level });
}
