import type { ReactNode } from 'react';

import { withMeta } from '../lib/componentMeta';
import { textOf } from '../lib/reactText';
import { slugify } from '../lib/slug';

interface HeadingProps {
  children?: ReactNode;
}

/**
 * Builds the heading renderer MDX uses for a given level: headings get a slug
 * id plus a sibling self-anchor marker, so any section of a document is
 * deep-linkable. The marker is a sibling (not a wrapper) so headings that
 * contain links never produce nested anchors.
 */
export function headingFor(level: 2 | 3 | 4) {
  const Tag = `h${level}` as const;
  function MdxHeading({ children }: HeadingProps) {
    const text = textOf(children);
    const slug = slugify(text);
    // No text to slug: render the heading, but with no id and no self-anchor.
    // Since #118 (2026-08-14) this is reachable from ordinary authoring — a
    // heading that is entirely a formula (`## $$\log_2 n$$`) has no text at all,
    // because `textOf` sees no strings — and it fails silently: no deep link, no
    // rail entry, green build, green suite. Contradicts ADR-0021 and ADR-0002
    // knowingly; the fix moves published slugs, so it needs its own migration
    // (ADR-0027 §8). The authoring guide tells authors to put text in a heading.
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
      </Tag>
    );
  }
  return withMeta(MdxHeading, { headingLevel: level });
}
