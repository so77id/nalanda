import { AuthoringError } from '../AuthoringError';
import { EmbedFrame } from './EmbedFrame';
import { sheetPreviewUrl } from './sheetUrl';

export interface SheetEmbedProps {
  /**
   * The sheet's share link, exactly as the Compartir button gives it. Must be
   * shared as "cualquiera con el enlace puede ver"; the component rewrites it
   * into the embeddable `/preview` form.
   */
  src?: string;
  /**
   * What this sheet is, in Spanish. Required: an iframe's accessible name comes
   * from `title` and nowhere else.
   */
  title?: string;
  /** How tall the frame is, in px. Capped against the stage on a slide. */
  height?: number;
}

/**
 * An iframe has no content-driven height — unset it is 150px of nothing — so
 * this is a decision, not a fallback. 480px shows roughly nine rows of the
 * course plan, which is a screenful without swallowing the page around it.
 */
const DEFAULT_HEIGHT = 480;

/**
 * What the frame is allowed to do. Every token was measured in a real browser
 * against the course's own sheet on 2026-08-16 rather than inherited by
 * omission — the record is in `docs/security-notes.md`.
 *
 * - `allow-scripts` renders the grid; without it there is nothing to see.
 * - `allow-popups` + `allow-popups-to-escape-sandbox` are ONE decision, not
 *   two. The course plan carries 14 `target="_blank"` links to the class decks:
 *   without the first the click is swallowed behind a console error, and with
 *   the first but not the second the deck opens and Google Slides fails with
 *   "Se produjo un error" — the new tab inherits this sandbox.
 *
 * `allow-same-origin` is deliberately absent: the sheet renders and scrolls
 * both ways without it, so the frame stays in an opaque origin.
 */
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

/**
 * A shared Google Sheet, rendered read-only inside the page.
 *
 * The professor edits the spreadsheet and the page follows — no commit, no
 * deploy. Deliberately the whole of it: this component does not read the sheet,
 * does not know its columns and transforms nothing. Google renders it; we frame
 * it and say how tall.
 *
 * It paints its own white ground, so in the dark theme it is a white rectangle.
 * That is accepted (#146) — the sheet's own cell colours are the information.
 */
export function SheetEmbed({ src, title, height = DEFAULT_HEIGHT }: SheetEmbedProps) {
  if (src === undefined || src === '') {
    return (
      <AuthoringError component="SheetEmbed">
        necesita un src con el enlace de la planilla.
      </AuthoringError>
    );
  }
  if (title === undefined || title === '') {
    return (
      <AuthoringError component="SheetEmbed">
        necesita un title que diga qué planilla es, en español: es lo único que un lector de
        pantalla anuncia de un marco.
      </AuthoringError>
    );
  }

  const url = sheetPreviewUrl(src);
  if (url === null) {
    return (
      <AuthoringError component="SheetEmbed">
        necesita el enlace de <strong>Compartir</strong> de una planilla de Google
        (docs.google.com/spreadsheets/d/…), no el de Publicar en la web. Este no sirve: {src}
      </AuthoringError>
    );
  }

  return (
    <EmbedFrame height={height} placeholder="Cargando la planilla…">
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
