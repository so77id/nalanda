import type { ReactNode } from 'react';

import { withMeta } from '../lib/componentMeta';
import { textOf } from '../lib/reactText';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
    if (!slug) return <Tag>{children}</Tag>;
    return (
      <Tag id={slug} className="group scroll-mt-8">
        {children}
        <a
          href={`#${slug}`}
          aria-label={`Link to section "${text}"`}
          // slate-600 was 2.66:1 against the page, under the 3:1 floor. And it
          // revealed itself only to a pointer: focusable-and-transparent meant a
          // keyboard user landed on it with nothing to see, focus outline included.
          className="ml-2 text-slate-400 no-underline opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          #
        </a>
      </Tag>
    );
  }
  return withMeta(MdxHeading, { headingLevel: level });
}
