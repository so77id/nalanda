import type { ReactNode } from 'react';

import { AuthoringError } from '../AuthoringError';
import { useDescribed } from '../described';
import { ASSET_PREFIX } from '../../lib/assetPrefix';
import { resolveAsset } from '../../lib/contentAssets';
import { warnOnce } from '../../lib/warnOnce';

export interface FigureProps {
  /**
   * The image, written relative to the document (`./curva.svg`).
   * `remarkContentImages` rewrites it into an `asset:` key on the way in.
   */
  src?: string;
  /** What the picture says, in Spanish. Required: the page is served `lang="es"`. */
  alt?: string;
  /** Visible caption under the image. */
  caption?: ReactNode;
  /**
   * If set, the figure floats to that side and the surrounding text wraps
   * around it. Same shape as a magazine/PowerPoint sidebar picture: the
   * paragraph next to the image reflows to fill the column, and once the
   * picture ends vertically the following prose gets the full width back.
   * Defaults to unset (block-level, centered as before).
   */
  float?: 'left' | 'right';
  /**
   * Max width when floating. One of `'xs' | 'sm' | 'md' | 'lg'` maps to
   * Tailwind's `max-w-*` sizes. Ignored when `float` is unset. Defaults
   * to `'sm'`, which is ~24rem — the width that leaves reading room on a
   * standard slide/book layout.
   */
  width?: 'xs' | 'sm' | 'md' | 'lg';
}

// Same treatment an unresolved wiki-link gets, in the same tokens: `flag` for
// the colour, a dashed border so the signal is not colour alone (ADR-0026).
const BROKEN_STYLE = 'rounded border border-dashed border-flag px-3 py-2 text-sm text-flag';

/**
 * One image with its alternative text and, optionally, its caption.
 *
 * The atom of the media family: it renders a picture and nothing else. Putting
 * one beside a block of text is `<Split>`, and a grid of them is `<Mosaic>` —
 * layout lives in containers that do not know what they hold, so a figure never
 * grows a prop about its neighbours.
 *
 * **`alt` is a runtime contract, not a type.** MDX is not typechecked: a
 * document that omits it compiles happily, and the reader who needs it is the
 * one who cannot see that it is missing. So the check has to hold here, and it
 * addresses the author (`AuthoringError`) rather than blaming the reader.
 */
export function Figure({ src, alt, caption, float, width = 'sm' }: FigureProps) {
  // A cell of a `<Mosaic>` is silent by design: the container already carries
  // the description for the whole group.
  const described = useDescribed();

  if (src === undefined || src === '') {
    return (
      <AuthoringError component="Figure">necesita un src con la ruta de la imagen.</AuthoringError>
    );
  }
  // `alt=""` stays an error outside a describing container, and `alt` missing is
  // an error even inside one: silence has to be something the author wrote.
  if (alt === undefined || (alt === '' && !described)) {
    return (
      <AuthoringError component="Figure">
        necesita un alt que describa la imagen, en español.
      </AuthoringError>
    );
  }

  const url = src.startsWith(ASSET_PREFIX) ? resolveAsset(src) : src;
  if (url === null) {
    const key = src.slice(ASSET_PREFIX.length);
    warnOnce(src, `Imagen no encontrada en content/: "${key}"`);
    return (
      <figure className="not-prose my-6">
        <p className={BROKEN_STYLE}>Falta la imagen: {key}</p>
      </figure>
    );
  }

  const widthClass = {
    xs: 'max-w-[16rem]',
    sm: 'max-w-[24rem]',
    md: 'max-w-[32rem]',
    lg: 'max-w-[40rem]',
  }[width];

  // When floating, the picture becomes an inline block the paragraph next to
  // it wraps around (like a magazine sidebar). It stays a `<figure>`, keeps
  // its caption alignment, and centers the caption UNDER the image inside
  // its narrower width. When not floating, unchanged from before.
  const floatClass =
    float === 'right'
      ? `float-right ml-6 mb-3 ${widthClass}`
      : float === 'left'
        ? `float-left mr-6 mb-3 ${widthClass}`
        : '';

  return (
    // `not-prose` because a figure is a block, not running text: without it the
    // reading measure narrows it to 39rem while the code beside it keeps the
    // full column (ADR-0022).
    <figure
      className={`not-prose my-6 flex flex-col items-center gap-2 ${floatClass}`.trim()}
    >
      <img src={url} alt={alt} className="max-w-full" />
      {caption === undefined ? null : (
        <figcaption className="text-center text-sm text-ink-faint">{caption}</figcaption>
      )}
    </figure>
  );
}
