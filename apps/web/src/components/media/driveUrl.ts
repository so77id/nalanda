/**
 * A Google Drive file url, captured as (file id). The same three concerns as
 * `sheetUrl.ts`, for a different host:
 *
 * - **Anchored at the scheme and the host, and the host is closed by the `/`
 *   that follows it**, because this value ends up in an `<iframe src>` that is
 *   granted `allow-same-origin`: the host is the whole of what that token
 *   trusts, so `https://drive.google.com.evil.example/…` must not match.
 * - **`(?:u\/\d+\/)?`** accepts the account-scoped form Drive puts in the
 *   address bar when the professor is signed into more than one account.
 * - **`/file/d/` and the 20-character floor**: only a single file has a viewer
 *   (a folder link is `/drive/folders/…`), and real ids are 33+ characters.
 */
const DRIVE_FILE_URL =
  /^https:\/\/drive\.google\.com\/file\/(?:u\/\d+\/)?d\/([\w-]{20,})(?:[/?#]|$)/;

/**
 * The resource key Google's 2021 security update added to the share links of
 * files that existed before it. Without it such a file answers with the
 * request-access page. **Carried across unverified**, like `sheetUrl.ts`'s
 * `gid`: Control 1's file has no key, so nothing has yet shown that `/preview`
 * honours it — measure against a keyed file before relying on it.
 */
const RESOURCE_KEY = /[?&]resourcekey=([\w-]+)/;

/**
 * The embeddable url for a shared Drive file, or `null` if this is not one.
 *
 * Authors paste what the Compartir button gives them, a `/view?usp=sharing`
 * url: Drive's full page, with its own header and sign-in button. `/preview`
 * is the bare viewer — it draws a PDF page by page, the same in every browser,
 * which is why a PDF goes through Drive instead of the browser's own viewer
 * (ADR-0076). Measured 2026-09-22: the `/preview` url answers 200 with no
 * `X-Frame-Options` and no `frame-ancestors` on a link-shared file.
 *
 * Pure and separate from the component for the reason `sheetPreviewUrl` is: a
 * refused url frames a blank rectangle and the suite stays green.
 */
export function drivePreviewUrl(src: string): string | null {
  const match = DRIVE_FILE_URL.exec(src.trim());
  if (match === null) return null;

  const key = RESOURCE_KEY.exec(src);
  const query = key === null ? '' : `?resourcekey=${key[1]}`;
  return `https://drive.google.com/file/d/${match[1]}/preview${query}`;
}
