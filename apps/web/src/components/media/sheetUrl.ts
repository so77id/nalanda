/**
 * A Google Sheets share url, captured as (spreadsheet id). Three parts earn
 * their keep:
 *
 * - **Anchored at the scheme and the host**, because this value ends up in an
 *   `<iframe src>`: the host is the whole of what is being trusted, and a
 *   pattern on the path alone accepts `https://evil.example/spreadsheets/d/…`.
 * - **`(?:u\/\d+\/)?`** accepts the account-scoped form Google puts in the
 *   address bar when the professor is signed into more than one account
 *   (`/spreadsheets/u/0/d/…`) — the url you get by copying from the address bar
 *   instead of the Compartir dialog, which is the likelier of the two.
 * - **`(?!e\/)` and the 20-character floor** keep the *published* form,
 *   `/spreadsheets/d/e/<token>/…`, out of this pattern. Without them it matches,
 *   captures the literal `"e"` as the id, and builds `/spreadsheets/d/e/preview`
 *   — a 404 that frames Google's own "el archivo que solicitaste no existe" with
 *   the whole suite green (#146 review). Real ids are 40+ characters. Either
 *   part alone refuses it — `/` is not in `[\w-]`, so the captured `"e"` can
 *   never reach the floor — and the lookahead stays because it is the one that
 *   says why (mutated in #336: only removing both turns a `/d/e/` url into the
 *   404). The published form has a pattern of its own since #336, below, and
 *   this one must still refuse it: otherwise every `/d/e/` url that is not a
 *   `/pubhtml` one would be rewritten into that 404 instead of reported.
 */
const SHARE_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/(?!e\/)([\w-]{20,})/;

/**
 * A Google Sheets *published* url, the one Archivo → Compartir → Publicar en la
 * web hands out as a page. Anchored like the share pattern and for the same
 * reason, and also **closed at the end of the path**, because this url reaches
 * the frame verbatim: without `(?:[?#]|$)`, `…/pubhtml/../../document/…` passes
 * and the browser resolves it to another docs.google.com document altogether.
 * The token Google mints is ~86 characters (`2PACX-…`); the floor is the share
 * pattern's. The other published outputs (`/pub?output=csv`, …) are downloads,
 * not pages, and are refused.
 */
const PUBLISHED_URL =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[\w-]{20,}\/pubhtml(?:[?#]|$)/;

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
 * The embeddable url for a Google Sheet, or `null` if this is not one. Two
 * forms are accepted, and they are not interchangeable (ADR-0087):
 *
 * - **The share link** (Compartir, `/d/<id>/edit?usp=sharing`) is rewritten to
 *   `/preview`. It needs only "anyone with the link can view" and shows the
 *   whole spreadsheet, every tab, with Google's tab bar.
 * - **The published link** (Publicar en la web, `/d/e/<token>/pubhtml?…`) is
 *   framed **exactly as given**. It needs the sheet published to the web — a
 *   setting of its own, separate from sharing — and it serves only the tabs
 *   chosen in that dialog: any other `gid` answers 401 (measured 2026-10-15).
 *   It honours `single` (no tab bar) and `range` (some columns only), which is
 *   why it is passed through rather than rebuilt: the query is the author's
 *   choice of what the frame shows, and a rewrite that dropped a parameter
 *   would show something else.
 *
 * **What the frame shows is not what is published.** `range` and `single` are
 * view parameters on a public url, not permissions: the same token with
 * `range=A1:C27` served the columns a `D1:Y27` link leaves out (measured
 * 2026-10-15, #336). Anything a reader must not see stays out of the published
 * tabs, never merely out of the range.
 *
 * Authors paste what the Compartir button gives them, which is an `/edit` url.
 * That url is **not** frame-blocked — Google sends no `frame-ancestors` and no
 * `X-Frame-Options` on it (checked with `curl -sI`, 2026-08-16) — it is simply
 * the wrong thing to publish: framed under this component's sandbox, without
 * `allow-same-origin`, the editor's own requests fail and it paints the grid
 * behind a "Se ha producido un error" dialog, editing chrome and all.
 * `/htmlembed`, measured the same day, works on a merely link-shared sheet but
 * shows no tab bar; `/preview` renders the sheet as Google draws it, so it is
 * the form a share link normalises to.
 *
 * Pure and separate from the component because the alternative is a silent
 * failure with the suite green: a refused url frames a blank rectangle, and the
 * only evidence is a console violation neither the author nor the reader sees.
 */
export function sheetEmbedUrl(src: string): string | null {
  const trimmed = src.trim();
  if (PUBLISHED_URL.test(trimmed)) return trimmed;

  const match = SHARE_URL.exec(trimmed);
  if (match === null) return null;

  const gid = GID.exec(src);
  const tab = gid === null ? '' : `?gid=${gid[1]}`;
  return `https://docs.google.com/spreadsheets/d/${match[1]}/preview${tab}`;
}
