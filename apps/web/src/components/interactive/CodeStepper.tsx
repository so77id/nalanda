import { useMemo } from 'react';

import { OUTPUT } from './Panel';

export interface CodeStepperProps {
  /** The listing shown, exactly as the author wrote it. */
  code: string;
  /** 1-based line numbers to highlight. Empty means no highlight this step. */
  highlightLines: number[];
  /**
   * Informational only — the language the author wrote the code in. Not used
   * for syntax colouring: the listing is deliberately plain (see below).
   */
  language?: string;
}

/**
 * A read-only code listing with per-line highlighting, driven by its props.
 *
 * The listing is rendered here as plain monospace text rather than through
 * `<CodeEditor>`, and the reason is bundle weight measured against a real
 * consumer. Earned in ADR-0028 §Consequences (amended by #122): giving the
 * diagram an editor would cost the CodeMirror core AND a grammar — the
 * `<StepShow>` consumer loads neither today, and would gain nothing from
 * either since the highlight is a per-line box, not tokenised colour.
 *
 * The same reasoning applies to every `<StepShow>` consumer: an author is
 * showing steps beside a visual, not editing code. Adding an editor here would
 * put CodeMirror in the bundle of every page that steps through anything —
 * exactly the weight #209 exists to shed.
 *
 * A per-line `data-line` attribute is what tests grab (`data-active` flags the
 * highlighted ones), a shape borrowed from `RecursionTree.tsx`'s `data-arg`:
 * jsdom cannot see the paint, so the semantic attribute is the stand-in the
 * suite can measure and the browser check confirms against the live tokens.
 */
export function CodeStepper({ code, highlightLines, language: _language }: CodeStepperProps) {
  const lines = useMemo(() => code.split('\n'), [code]);
  const active = useMemo(() => new Set(highlightLines), [highlightLines]);

  return (
    <div className="bg-surface">
      <pre className={`${OUTPUT} max-h-96 text-ink-soft`}>
        {lines.map((line, index) => {
          const number = index + 1;
          const isActive = active.has(number);
          return (
            <div
              key={number}
              data-line={number}
              data-active={isActive}
              className={`flex gap-3 px-1 ${isActive ? 'bg-keep-soft text-ink' : ''}`}
            >
              <span className="w-8 shrink-0 text-right text-ink-faint select-none">{number}</span>
              <span className="whitespace-pre">{line === '' ? ' ' : line}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
