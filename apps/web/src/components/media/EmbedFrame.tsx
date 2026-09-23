import type { ReactNode } from 'react';

import { SLIDE_BUDGET_VH } from '../slideBudget';
import { useMode } from '../../presentation';

interface EmbedFrameProps {
  /** How tall the frame is, in px. Capped against the stage on a slide. */
  height: number;
  /** What the reader sees until the provider paints, in Spanish. */
  placeholder: string;
  /** The `<iframe>` itself — its url, sandbox and policies are each embed's own. */
  children: ReactNode;
}

/**
 * The rectangle every third-party embed sits in: `<SheetEmbed>`,
 * `<VideoEmbed>` and `<PdfEmbed>`. Extracted at the third copy (#299 review);
 * what differs between them — the url, the sandbox, the referrer policy — is
 * on the `<iframe>` each passes in, and stays theirs.
 *
 * Not an MDX component and not exported from the seam: an author never writes
 * one, so it has no catalog entry.
 */
export function EmbedFrame({ height, placeholder, children }: EmbedFrameProps) {
  const mode = useMode();

  return (
    // The wrapper exists for the placeholder, not for layout: an unloaded
    // iframe is transparent, so a sibling underneath it shows through and is
    // covered the moment the provider paints its own ground. Measured on a
    // ~1.6 Mbps connection (#146), that window is about six seconds, during
    // which the reader would otherwise be looking at an empty bordered box —
    // indistinguishable from the failures an embed accepts as undetectable (an
    // unshared file, the provider down). `aria-hidden` because the frame
    // already has an accessible name and the placeholder is not content.
    //
    // `not-prose` because a frame is a block, not running text: the measure
    // would otherwise narrow it to 39rem inside the column (ADR-0022).
    //
    // No `overflow-x-auto`, and that is not the oversight it looks like:
    // ADR-0013 §5.2 governs a scroller in THIS document, and the frame's is in
    // another one, so the deck's swipe can never see it. Measured for the
    // sheet; the numbers are in ADR-0035 §Consequences.
    //
    // On a slide the height is capped: a slide is fit and uniformly scaled
    // (ADR-0013 §5.1), so an oversized frame is not clipped, it shrinks the
    // whole slide with its title.
    <div
      className="not-prose relative my-6 rounded bg-sunk"
      style={{
        height: mode === 'presentation' ? `min(${height}px, ${SLIDE_BUDGET_VH}vh)` : `${height}px`,
      }}
    >
      <p
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint"
      >
        {placeholder}
      </p>
      {children}
    </div>
  );
}
