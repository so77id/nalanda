import type { ReactNode } from 'react';

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface HeadingProps {
  children?: ReactNode;
}

/**
 * Builds the heading renderer MDX uses for a given level: headings get a slug
 * id and link to themselves, so any section of a document is deep-linkable.
 */
export function headingFor(level: 2 | 3 | 4) {
  const Tag = `h${level}` as const;
  function MdxHeading({ children }: HeadingProps) {
    const slug = slugify(textOf(children));
    if (!slug) return <Tag>{children}</Tag>;
    return (
      <Tag id={slug} className="group scroll-mt-8">
        <a href={`#${slug}`} className="no-underline">
          {children}
          <span className="ml-2 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100">
            #
          </span>
        </a>
      </Tag>
    );
  }
  return MdxHeading;
}
