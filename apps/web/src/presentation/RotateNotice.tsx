import { RotateCwSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * What a phone held upright gets instead of the deck: slides need the long side
 * of the screen, and nothing else on this route is rendered behind this panel.
 */
export function RotateNotice() {
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
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-slate-950 px-8 text-center text-slate-100"
    >
      <RotateCwSquare size={48} aria-hidden="true" className="text-slate-500" />
      <h1 id="rotate-notice-title" className="text-2xl font-bold tracking-tight">
        Gira el teléfono
      </h1>
      <p id="rotate-notice-text" className="text-slate-400">
        La presentación se ve en horizontal.
      </p>
    </div>
  );
}
