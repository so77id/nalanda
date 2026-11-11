import { FileCode2, Maximize2 } from 'lucide-react';

import { CodeStepper } from './CodeStepper';
import type { Excerpt } from './codeExcerpt';

export interface CodeListingProps {
  /** The file the listing stands for, shown in its header. */
  name: string;
  /** The text shown. */
  code: string;
  /**
   * Where the text sits in its file, when it was cut out of one (ADR-0091):
   * the gutter counts from `first`, the header names the range, and a fold row
   * says how many lines stay hidden above and below. Absent for a listing
   * written in the document itself, which has no file to point into.
   */
  excerpt?: Excerpt;
  /** The listing's own 1-based lines to light. */
  lines: number[];
  language?: string;
  /** Take what the column has left — the last listing of a walk. */
  grow?: boolean;
  /** Open the whole file; offered only when there is a file to open. */
  onOpen?: () => void;
}

/**
 * One listing with the header a code host gives a quoted file: an icon, the
 * file's name, the lines quoted out of how many, and a button that opens the
 * whole file — the shape a reader already knows from a permalink to a range
 * of a file (#363). Above and below the quoted lines, a fold row counts the
 * lines left out, so a fragment never reads as the whole class.
 */
export function CodeListing({
  name,
  code,
  excerpt,
  lines,
  language,
  grow = false,
  onOpen,
}: CodeListingProps) {
  const partial = excerpt !== undefined && (excerpt.above > 0 || excerpt.below > 0);
  return (
    <div
      data-testid="stepshow-listing"
      data-listing={name}
      className={grow ? 'flex flex-1 flex-col bg-surface' : 'flex flex-col bg-surface'}
    >
      <div className="flex items-center gap-2 border-b border-rule bg-sunk px-3 py-0.5">
        {excerpt === undefined ? null : (
          <FileCode2 className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden />
        )}
        <span className="font-mono text-xs font-semibold text-ink">{name}</span>
        {excerpt === undefined ? null : (
          <span className="font-mono text-3xs text-ink-faint" data-testid="listing-range">
            {partial
              ? `líneas ${excerpt.first}–${excerpt.last} de ${excerpt.total}`
              : `${excerpt.total} ${excerpt.total === 1 ? 'línea' : 'líneas'}`}
          </span>
        )}
        {onOpen === undefined ? null : (
          <button
            type="button"
            onClick={onOpen}
            className="ml-auto inline-flex items-center gap-1 rounded border border-rule bg-surface px-1.5 py-0.5 text-3xs text-ink-soft hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Maximize2 className="h-3 w-3" aria-hidden />
            Ver archivo
          </button>
        )}
      </div>
      {excerpt !== undefined && excerpt.above > 0 ? (
        <Fold count={excerpt.above} where="arriba" onOpen={onOpen} />
      ) : null}
      <CodeStepper
        code={code}
        highlightLines={lines}
        language={language}
        firstLine={excerpt?.first ?? 1}
      />
      {excerpt !== undefined && excerpt.below > 0 ? (
        <Fold count={excerpt.below} where="abajo" onOpen={onOpen} />
      ) : null}
      {grow ? <div className="flex-1 bg-surface" /> : null}
    </div>
  );
}

/** The row that stands for the lines a listing leaves out of its file. */
function Fold({ count, where, onOpen }: { count: number; where: string; onOpen?: () => void }) {
  const text = `⋯ ${count} ${count === 1 ? 'línea' : 'líneas'} ${where}`;
  return onOpen === undefined ? (
    <div
      data-testid="listing-fold"
      className="bg-sunk px-3 font-mono text-3xs leading-4 text-ink-faint"
    >
      {text}
    </div>
  ) : (
    <button
      type="button"
      data-testid="listing-fold"
      onClick={onOpen}
      aria-label={`${text}: ver el archivo completo`}
      className="bg-sunk px-3 text-left font-mono text-3xs leading-4 text-ink-faint hover:bg-accent-soft hover:text-ink-soft"
    >
      {text}
    </button>
  );
}
