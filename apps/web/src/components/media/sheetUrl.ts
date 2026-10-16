/**
 * A Google Sheets share url, captured as (spreadsheet id). Four parts earn
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
 *   the whole suite green (#146 review). Real ids are 40+ characters. The floor
 *   alone would refuse it too (`/` is not in `[\w-]`), but the floor is about
 *   id length; the lookahead fences off the `/d/e/` namespace, and still holds
 *   if the floor is ever lowered. The published page has a pattern of its own,
 *   below; every other `/d/e/` url must still be refused here, not rewritten
 *   into that 404.
 * - **`(?![\w-]|\/pub)`** refuses the id-based published link Google handed out
 *   before the `/d/e/` token, `/d/<id>/pubhtml?…&range=…`. Rewritten to
 *   `/preview` it would silently drop `range` and `single` and frame the whole
 *   sheet. The `[\w-]` half keeps the id capture maximal: without it the
 *   pattern backtracks to a shorter id, whose next character is not a `/`, and
 *   the `/pub` check passes.
 */
const SHARE_URL =
  /^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/(?!e\/)([\w-]{20,})(?![\w-]|\/pub)/;

/**
 * A Google Sheets *published* url, the one Archivo → Compartir → Publicar en la
 * web hands out as a page, captured as (token, query-and-fragment). Anchored
 * like the share pattern, and **closed at the end of the path**: the tail must
 * start with `?` or `#`, so nothing the author writes can reach the path, and
 * the `$` makes a url that runs on past `pubhtml` (`…/pubhtml/../../document`)
 * an authoring error rather than one silently cut back to `/pubhtml`. The url
 * is rebuilt from literals either way, so these parts decide whether a bad
 * link is refused or quietly turned into a working one — never which site is
 * framed. The token Google mints is ~86 characters (`2PACX-…`); the floor is
 * the share pattern's. The other published outputs (`/pub?output=csv`, …) are
 * downloads, not pages, and are refused.
 */
const PUBLISHED_URL =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/([\w-]{20,})\/pubhtml((?:[?#][\s\S]*)?)$/;

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
 *   rebuilt around its token with **its query and fragment carried across
 *   whole**. It needs the sheet published to the web — a setting of its own,
 *   separate from sharing — and it serves each published tab whole. It honours
 *   `single` (one tab, though a strip naming it stays at the foot) and `range`
 *   (some columns only). The query is the author's choice of what the frame
 *   shows, so it is not parsed: a rewrite that dropped a parameter would show
 *   something else. That makes this the one url in the module whose tail is the
 *   author's — the exception `frontend-code-style.md` §Components names.
 *   **The rebuild changes no output today**: the pattern matches the whole
 *   string from a literal prefix, so every url it accepts comes back
 *   byte-identical, and no test can tell the rebuild from returning the input.
 *   It is a backstop for the day the pattern is loosened, deliberately not held
 *   by a test.
 *
 * **What the frame shows is not what is published.** `range` and `single` are
 * view parameters on a public url, not permissions: the same token with
 * `range=A1:C27` served the columns a `D1:Y27` link leaves out (measured
 * 2026-10-15). Anything a reader must not see stays out of every published
 * tab, never merely out of the range — and the file's own sharing is
 * restricted too, or its share link still opens every tab. That an existing
 * unpublished tab is refused, and that a restricted file keeps serving its
 * publication, are what Google's dialogs offer; neither is measured here.
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

  const published = PUBLISHED_URL.exec(trimmed);
  if (published !== null) {
    return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pubhtml${published[2]}`;
  }

  const match = SHARE_URL.exec(trimmed);
  if (match === null) return null;

  const gid = GID.exec(trimmed);
  const tab = gid === null ? '' : `?gid=${gid[1]}`;
  return `https://docs.google.com/spreadsheets/d/${match[1]}/preview${tab}`;
}
