/**
 * A Google Sheets url, captured as (spreadsheet id). Anchored at the scheme and
 * the host on purpose: this is the value that ends up in an `<iframe src>`, so
 * the host is the whole of what is being trusted, and matching the PATH alone
 * would accept `https://evil.example/spreadsheets/d/…`.
 */
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/;

/** The tab of a multi-sheet document, wherever Google put it in the link. */
const GID = /[?#&]gid=(\d+)/;

/**
 * The embeddable url for a shared Google Sheet, or `null` if this is not one.
 *
 * Authors paste what the Compartir button gives them, which is an `/edit` url —
 * and `/edit` is refused by Google's own `frame-ancestors` (measured in a real
 * iframe on 2026-08-16, alongside `/pubhtml` and `/htmlembed`, which work but
 * first require publishing the sheet to the web). `/preview` needs nothing but
 * "anyone with the link can view", so it is the one form this normalises to.
 *
 * Pure and separate from the component because the alternative is a silent
 * failure with the suite green: a refused url frames a blank rectangle, and the
 * only evidence is a console violation neither the author nor the reader sees.
 */
export function sheetPreviewUrl(src: string): string | null {
  const match = SHEET_URL.exec(src.trim());
  if (match === null) return null;

  const gid = GID.exec(src);
  const tab = gid === null ? '' : `?gid=${gid[1]}`;
  return `https://docs.google.com/spreadsheets/d/${match[1]}/preview${tab}`;
}
