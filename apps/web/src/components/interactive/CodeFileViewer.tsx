import { FileCode2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CodeStepper } from './CodeStepper';

/** One file the viewer can show: its whole text, and what of it to mark. */
export interface ViewerFile {
  name: string;
  source: string;
  /** The file lines a slide quotes, marked with a band. */
  first: number;
  last: number;
  /** The file lines lit at the current step. */
  lines: number[];
}

export interface CodeFileViewerProps {
  /** Shown in the viewer's title bar: the walk or listing it was opened from. */
  title?: string;
  files: ViewerFile[];
  /** The tab it opens on. */
  start: number;
  onClose: () => void;
  /** Walk the step from inside the viewer, when it was opened from a walk. */
  onPrev?: () => void;
  onNext?: () => void;
  /** «paso 3 de 19», when opened from a walk. */
  status?: string;
}

/**
 * The files of a listing, whole, over the page: one tab per file, the quoted
 * lines banded, the step's lines lit (#363, ADR-0091). Rendered into
 * `document.body` — a slide is scaled with a transform, which would otherwise
 * become the fixed box's containing block — and it takes the keyboard while
 * open: Escape closes it (and only it, not the deck), the arrows walk the step,
 * and nothing reaches the deck's window listener underneath.
 */
export function CodeFileViewer({
  title,
  files,
  start,
  onClose,
  onPrev,
  onNext,
  status,
}: CodeFileViewerProps) {
  const [tab, setTab] = useState(Math.min(Math.max(start, 0), files.length - 1));
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  );

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return undefined;
    el.focus();
    const onKey = (event: KeyboardEvent) => {
      // Native, on the dialog: stopped here it never reaches the deck, which
      // listens on window and would otherwise turn the slide or leave it.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight' && onNext) {
        event.preventDefault();
        onNext();
      } else if (event.key === 'ArrowLeft' && onPrev) {
        event.preventDefault();
        onPrev();
      }
    };
    el.addEventListener('keydown', onKey);
    const back = opener.current;
    return () => {
      el.removeEventListener('keydown', onKey);
      if (back instanceof HTMLElement) back.focus();
    };
  }, [onClose, onNext, onPrev]);

  const file = files[tab]!;
  const band = [];
  for (let n = file.first; n <= file.last; n++) band.push(n);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Archivo ${file.name}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-rule bg-surface text-ink shadow-xl outline-none"
      >
        <header className="flex items-center gap-2 bg-sunk px-3 py-2">
          <span className="text-sm font-medium">{title ?? file.name}</span>
          {status === undefined ? null : (
            <span className="ml-2 font-mono text-3xs text-ink-faint">{status}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar el archivo"
            className="ml-auto rounded p-1 text-ink-soft hover:bg-accent-soft"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div
          role="tablist"
          aria-label="Archivos"
          className="flex gap-1 border-b border-rule bg-sunk px-2"
        >
          {files.map((f, i) => (
            <button
              key={f.name}
              type="button"
              role="tab"
              aria-selected={i === tab}
              onClick={() => setTab(i)}
              className={
                i === tab
                  ? '-mb-px inline-flex items-center gap-1.5 rounded-t border border-b-surface border-rule bg-surface px-3 py-1.5 font-mono text-xs font-semibold text-ink'
                  : 'inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs text-ink-soft hover:text-ink'
              }
            >
              <FileCode2 className="h-3.5 w-3.5" aria-hidden />
              {f.name}
            </button>
          ))}
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto"
          data-testid="viewer-file"
          data-file={file.name}
        >
          <CodeStepper
            code={file.source.replace(/\n$/, '')}
            highlightLines={file.lines}
            bandLines={band}
          />
        </div>
        {onPrev === undefined && onNext === undefined ? null : (
          <footer className="flex items-center gap-2 border-t border-rule bg-sunk px-3 py-1.5 text-3xs text-ink-faint">
            ← → recorren los pasos · Esc cierra
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
