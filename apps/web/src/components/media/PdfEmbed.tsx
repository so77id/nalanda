import { AuthoringError } from '../AuthoringError';
import { EmbedFrame } from './EmbedFrame';
import { drivePreviewUrl } from './driveUrl';

export interface PdfEmbedProps {
  /**
   * The file's share link, exactly as Drive's Compartir button gives it. Must be
   * shared as "cualquiera con el enlace puede ver"; the component rewrites it
   * into the embeddable `/preview` form.
   */
  src?: string;
  /**
   * What this document is, in Spanish. Required: an iframe's accessible name
   * comes from `title` and nowhere else.
   */
  title?: string;
  /** How tall the frame is, in px. Capped against the stage on a slide. */
  height?: number;
}

/**
 * Most of one US-letter page — the size a control and its pauta are printed
 * at (ADR-0042) — at the width of the reading column, so the reader sees a
 * page's worth before scrolling inside the frame.
 */
const DEFAULT_HEIGHT = 800;

/**
 * What the frame is allowed to do. Each token was measured on 2026-09-22 in
 * Chromium and WebKit against Control 1's pauta, and the record is in ADR-0076:
 *
 * - `allow-scripts`: the viewer is a script; nothing paints without it.
 * - `allow-same-origin`: without it the viewer's own requests are cancelled and
 *   its spinner never resolves. This is the token `SheetEmbed` refuses. Scripts
 *   plus same-origin let a framed document lift its own sandbox only when it is
 *   same-origin with this site. The frame STARTS at `drive.google.com` —
 *   `drivePreviewUrl`'s anchored host guarantees that much — and afterwards only
 *   Drive's own viewer can navigate it; the protection rests on that viewer
 *   never sending the frame to a `so77id.github.io` page (security-notes.md).
 * - `allow-popups` + `allow-popups-to-escape-sandbox`: the viewer's pop-out
 *   button. Without the first the click does nothing; without the second the
 *   new tab inherits this sandbox and its download button downloads nothing.
 */
const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';

/**
 * A PDF shared from Google Drive, drawn by Drive's own viewer inside the page.
 *
 * Drive, not the browser: the browsers' built-in PDF viewers disagree (Brave
 * shows one page, ADR-0047) and Chrome on Android shows none at all in a frame.
 * Drive draws the pages itself, the same everywhere. And, as with
 * `<SheetEmbed>`, the professor replaces the file in Drive and the page follows
 * with no commit and no deploy. The component does not read the file.
 *
 * It paints its own dark ground around the page, in both themes.
 */
export function PdfEmbed({ src, title, height = DEFAULT_HEIGHT }: PdfEmbedProps) {
  if (src === undefined || src === '') {
    return (
      <AuthoringError component="PdfEmbed">
        necesita un src con el enlace del archivo en Google Drive.
      </AuthoringError>
    );
  }
  if (title === undefined || title === '') {
    return (
      <AuthoringError component="PdfEmbed">
        necesita un title que diga qué documento es, en español: es lo único que un lector de
        pantalla anuncia de un marco.
      </AuthoringError>
    );
  }

  const url = drivePreviewUrl(src);
  if (url === null) {
    return (
      <AuthoringError component="PdfEmbed">
        necesita el enlace de <strong>Compartir</strong> de un archivo de Google Drive
        (drive.google.com/file/d/…). Este no sirve: {src}
      </AuthoringError>
    );
  }

  return (
    <EmbedFrame height={height} placeholder="Cargando el documento…">
      <iframe
        src={url}
        title={title}
        sandbox={SANDBOX}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="relative h-full w-full rounded border border-rule"
      />
    </EmbedFrame>
  );
}
