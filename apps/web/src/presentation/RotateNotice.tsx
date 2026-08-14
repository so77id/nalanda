import { RotateCwSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  /** Document to fall back to — the way out is the book view of this document. */
  docId: string;
}

/**
 * What a phone held upright gets instead of the deck: slides need the long side
 * of the screen, and nothing else on this route is rendered behind this panel.
 */
export function RotateNotice({ docId }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  // The panel appears without the reader doing anything, so it takes the focus
  // to be announced — and there is nothing else on the route to take it from.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div
      ref={panel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="rotate-notice-title"
      aria-describedby="rotate-notice-text"
      tabIndex={-1}
      className="fixed inset-0 h-[100dvh] z-40 flex flex-col items-center justify-center gap-4 bg-deck-ground px-8 text-center text-ink"
    >
      <RotateCwSquare size={48} aria-hidden="true" className="text-ink-faint" />
      <h1 id="rotate-notice-title" className="text-2xl font-bold tracking-tight">
        Gira el teléfono
      </h1>
      <p id="rotate-notice-text" className="text-ink-faint">
        La presentación se ve en horizontal. Desliza para pasar de diapositiva.
      </p>
      {/* An absolute route, not history.back(): a reader who opened /present
          from a link or a bookmark has nothing behind them — and a phone with
          rotation locked in the OS needs this to be a real way out. */}
      <Link
        to={`/d/${docId}`}
        className="rounded border border-rule px-4 py-2 text-ink-soft hover:bg-sunk hover:text-ink"
      >
        Leer en el libro
      </Link>
    </div>
  );
}
