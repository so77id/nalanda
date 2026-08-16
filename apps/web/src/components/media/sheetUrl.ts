/**
 * A Google Sheets url, captured as (spreadsheet id). Three parts earn their
 * keep:
 *
 * - **Anchored at the scheme and the host**, because this value ends up in an
 *   `<iframe src>`: the host is the whole of what is being trusted, and a
 *   pattern on the path alone accepts `https://evil.example/spreadsheets/d/…`.
 * - **`(?:u\/\d+\/)?`** accepts the account-scoped form Google puts in the
 *   address bar when the professor is signed into more than one account
 *   (`/spreadsheets/u/0/d/…`) — the url you get by copying from the address bar
 *   instead of the Compartir dialog, which is the likelier of the two.
 * - **`(?!e\/)` and the 20-character floor** refuse the *published* form,
 *   `/spreadsheets/d/e/<token>/pubhtml`. Without them it matches, captures the
 *   literal `"e"` as the id, and builds `/spreadsheets/d/e/preview` — a 404
 *   that frames Google's own "el archivo que solicitaste no existe" with the
 *   whole suite green (#146 review). Real ids are 40+ characters.
 */
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/(?!e\/)([\w-]{20,})/;

/**
 * The tab of a multi-sheet document, wherever Google put it in the link.
 *
 * **The rewrite from `#gid=` to `?gid=` is unverified**, unlike everything else
 * in this module: the course's own sheet has one tab, so the probe that
 * measured the url forms could not tell a working query from an ignored one.
 * Measure it against a two-tab sheet before relying on it — if `/preview`
 * honours the fragment instead, this must emit `#gid=`.
 */
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
