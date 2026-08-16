/**
 * The slug a heading gets, and therefore the anchor a question points at.
 *
 * Shared rather than duplicated: these slugs are PUBLISHED — a section's slug
 * is its deep link (ADR-0021) — so a second implementation that drifted would
 * either break live URLs or make a question's anchor resolve against something
 * the page never renders. Shared for that reason rather than for tidiness; grep
 * for the callers, which move.
 *
 * Sharing the FUNCTION does not make the two spines agree, and they can still
 * differ on the heading SET: the rendered path slugs `textOf`, which contributes
 * nothing for an element. `app/questionReaders.test.tsx` is what holds them
 * together.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
