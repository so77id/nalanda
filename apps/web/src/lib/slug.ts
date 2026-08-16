/**
 * The slug a heading gets, and therefore the anchor a question points at.
 *
 * Shared rather than duplicated: these slugs are PUBLISHED — a section's slug
 * is its deep link (ADR-0021) — so a second implementation that drifted would
 * either break live URLs or make a question's anchor resolve against something
 * the page never renders. One function, two callers: `content/mdxHeading.tsx`
 * writes the id, `content/questionAnchors.ts` checks anchors against it.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
