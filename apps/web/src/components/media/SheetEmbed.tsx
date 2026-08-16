import { AuthoringError } from '../AuthoringError';
import { useMode } from '../../presentation';
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
 * How much of the slide's height the frame may take before the title and the
 * deck's own chrome start losing room. Same budget and the same reasoning as
 * `<Mosaic>`: a slide is fit and uniformly scaled (ADR-0013 §5.1), so an
 * oversized frame is not clipped — it shrinks the whole slide, text included.
 */
const SLIDE_BUDGET_VH = 64;

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
  const mode = useMode();

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
        necesita un enlace de Google Sheets (docs.google.com/spreadsheets/d/…), y este no lo es:{' '}
        {src}
      </AuthoringError>
    );
  }

  return (
    // `not-prose` because a framed sheet is a block, not running text: without
    // it the reading measure narrows it to 39rem inside the column (ADR-0022).
    // Measured in the book at 1440: 768px of column, against 624px for the
    // prose above it.
    //
    // It carries no `overflow-x-auto`, and that is not the oversight it looks
    // like. ADR-0013 §5.2 makes a component that pans sideways declare itself a
    // real scroller or have the drag taken as a slide change — but the sheet's
    // scroller lives inside ANOTHER DOCUMENT, so the deck never sees the touch
    // at all. Measured on an iPhone 13 in landscape, same slide, same gesture:
    // dragging inside the frame left `?slide` untouched, dragging on the ground
    // beside it moved 2 -> 1. Adding the class here would only advertise a
    // scroller this element does not have.
    //
    // The height rides on the wrapper rather than the frame so the cap is one
    // value in one place, and `min()` lets the slide keep the author's number
    // whenever it already fits. Measured: at 1024x768 the frame draws at its
    // full 480px (64vh = 491px, so the author's number wins and the slide is
    // not scaled at all); on a 750x342 phone the cap bites at 219px and the
    // deck fits the slide at 0.85, well above the half-scale legibility floor.
    <div
      className="not-prose my-6"
      style={{
        height: mode === 'presentation' ? `min(${height}px, ${SLIDE_BUDGET_VH}vh)` : `${height}px`,
      }}
    >
      <iframe
        src={url}
        title={title}
        sandbox={SANDBOX}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="h-full w-full rounded border border-rule"
      />
    </div>
  );
}
