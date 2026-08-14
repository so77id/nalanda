import type { ImgHTMLAttributes } from 'react';

import { ASSET_PREFIX } from '../lib/assetPrefix';
import { resolveAsset } from '../lib/contentAssets';
import { warnOnce } from '../lib/warnOnce';

// `flag` and not a raw colour: a raw one is right in at most one theme and no
// jsdom test can see which (ADR-0026, design-system.md). The dashed border is
// the second signal colour is not allowed to carry alone.
const BROKEN_STYLE =
  'inline-block rounded border border-dashed border-flag px-2 py-1 text-sm text-flag';

type Props = ImgHTMLAttributes<HTMLImageElement>;

/**
 * Image renderer for MDX documents: resolves the `asset:` urls emitted by
 * `remarkContentImages` against the built asset map; an asset that is not in
 * `content/` renders visibly broken instead of a broken-image icon.
 *
 * Broken rather than fatal, deliberately and by precedent: an unresolved
 * wiki-link renders wavy and warns (ADR-0002), because writing a document
 * before its target exists is a legitimate order of work — and a picture that
 * has not been drawn yet is the same situation.
 */
export function MdxImage({ src = '', alt, ...rest }: Props) {
  if (typeof src === 'string' && src.startsWith(ASSET_PREFIX)) {
    const url = resolveAsset(src);
    if (url === null) {
      const key = src.slice(ASSET_PREFIX.length);
      warnOnce(src, `Imagen no encontrada en content/: "${key}"`);
      return <span className={BROKEN_STYLE}>Falta la imagen: {key}</span>;
    }
    return <img {...rest} src={url} alt={alt} />;
  }

  return <img {...rest} src={src} alt={alt} />;
}
