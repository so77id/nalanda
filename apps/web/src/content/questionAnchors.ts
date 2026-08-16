import { slugify } from '../lib/slug';

/** One question's claim about which section it belongs to. */
export interface AnchoredQuestion {
  id: string;
  anchor: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*$/;
const H2 = /^ {0,3}## +(.+?)\s*$/;
const SLIDE_TITLE = /<Slide\b[^>]*?\btitle="([^"]*)"/g;
const QUESTION = /<Question\b([^>]*)>/g;
const ATTR = (name: string) => new RegExp(`\\b${name}="([^"]*)"`);

/**
 * The source with fenced code blocks blanked out.
 *
 * Lines are kept (blanked, not deleted) so nothing downstream has to care that
 * this happened. A `## comentario` inside a shell listing is not a section, and
 * counting it would let a broken anchor resolve against a heading the page
 * never renders — which is worse than not checking at all, because it reports
 * success.
 */
function withoutFences(source: string): string {
  const out: string[] = [];
  let closing: string | null = null;
  for (const line of source.split('\n')) {
    if (closing === null) {
      const opened = FENCE.exec(line);
      if (opened) {
        closing = opened[1] ?? null;
        out.push('');
        continue;
      }
      out.push(line);
      continue;
    }
    // A fence closes on a marker at least as long as the one that opened it.
    if (line.trimStart().startsWith(closing)) closing = null;
    out.push('');
  }
  return out.join('\n');
}

/**
 * Every section slug the document renders, in document order.
 *
 * A section is an `h2` (ADR-0021), and a `<Slide title>` renders one too — which
 * is where most anchors point, because most of the teaching path is written as
 * slides.
 */
export function headingSlugs(source: string): string[] {
  const body = withoutFences(source);
  const slugs: string[] = [];
  for (const line of body.split('\n')) {
    const heading = H2.exec(line);
    if (heading?.[1]) slugs.push(slugify(heading[1]));
  }
  for (const [, title] of body.matchAll(SLIDE_TITLE)) {
    if (title !== undefined) slugs.push(slugify(title));
  }
  return slugs;
}

/** Every question that names a section, with the section it names. */
export function questionAnchors(source: string): AnchoredQuestion[] {
  const out: AnchoredQuestion[] = [];
  for (const [, attributes = ''] of withoutFences(source).matchAll(QUESTION)) {
    const anchor = ATTR('anchor').exec(attributes)?.[1];
    const id = ATTR('id').exec(attributes)?.[1];
    // No anchor is not a missing anchor: an unanchored question belongs to the
    // whole document on purpose, and only enters a control whose range covers
    // the document entirely.
    if (anchor === undefined || anchor === '' || id === undefined) continue;
    out.push({ id, anchor });
  }
  return out;
}

/**
 * The questions whose anchor matches no section of their own document.
 *
 * Reported rather than thrown, and checked by the suite rather than the build:
 * drafting a question before its section exists is a real order of work, so the
 * build stays green and `npm run test` is what refuses to let it be published.
 */
export function unresolvedAnchors(source: string): AnchoredQuestion[] {
  const sections = new Set(headingSlugs(source));
  return questionAnchors(source).filter(({ anchor }) => !sections.has(anchor));
}
