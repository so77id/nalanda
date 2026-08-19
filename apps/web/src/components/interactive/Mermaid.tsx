import { useEffect, useId, useRef, useState } from 'react';

import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { AuthoringError } from '../AuthoringError';

export interface MermaidProps {
  /** The diagram source, as an author would write it in a mermaid fence. Required. */
  source?: string;
  /** Optional accessible label for the rendered SVG (falls back to a generic one). */
  title?: string;
}

/**
 * A course-content diagram, rendered from a mermaid source string (ADR-0040).
 *
 * Loads the `mermaid` library on demand inside the effect and hands it the
 * source. The library parses, lays out and produces an SVG string; the
 * component drops it into its container as HTML. On theme change the diagram
 * re-renders — the initialize call reads `theme: 'default' | 'dark'`, and
 * `useResolvedTheme` is the SSOT for anything a stylesheet cannot express
 * (same reason `<CodeEditor>` uses it — see `useResolvedTheme.ts`).
 *
 * **jsdom cannot run the real library** (it needs SVG layout APIs the runtime
 * does not implement), so the suite exercises the effect only against a stub —
 * `Mermaid.test.tsx` pins the contract: the container attributes, the source
 * handed to the library, the theme it initializes with, `securityLevel` at
 * 'strict', the error branch and its recovery. The paint itself is verified in
 * a real browser at S9 (apps/web/CLAUDE.md §the suite cannot lay out a page,
 * and ADR-0040 §Consequences).
 */
export function Mermaid({ source, title }: MermaidProps) {
  const theme = useResolvedTheme();
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const reactId = useId();
  // Mermaid derives DOM ids from this and forbids characters React's `useId`
  // emits (colons). One character-class replace keeps the id stable across
  // renders and legal for the library.
  const safeId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    if (source === undefined || source.trim() === '') return;
    const el = container.current;
    if (el === null) return;

    let cancelled = false;

    // Every attempt starts clean: a failed render must not be a dead end.
    // The previous paint (or the absence of one) is cleared here, and the
    // error is dropped the moment a new attempt begins — otherwise the error
    // branch unmounts nothing (the figure stays mounted below) but the stale
    // SVG would keep showing as if it were the current source's paint.
    el.innerHTML = '';
    setError(null);

    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
          fontFamily: 'inherit',
        });
        const { svg } = await mermaid.render(safeId, source);
        if (cancelled) return;
        el.innerHTML = svg;
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, theme, safeId]);

  if (source === undefined || source.trim() === '') {
    return (
      <AuthoringError component="Mermaid">
        falta la prop <code>source</code>. Escribe el diagrama como si fuera un fence{' '}
        <code>mermaid</code>, en un string.
      </AuthoringError>
    );
  }

  return (
    <figure
      className="not-prose my-6 flex flex-col justify-center overflow-x-auto rounded-lg border border-rule bg-surface p-4"
      aria-label={title ?? 'diagrama'}
    >
      {error !== null && (
        <AuthoringError component="Mermaid">
          Mermaid rechazó el diagrama: <code>{error}</code>. Revisá la sintaxis en{' '}
          <a href="https://mermaid.js.org/" rel="noreferrer">
            mermaid.js.org
          </a>
          .
        </AuthoringError>
      )}
      <div ref={container} data-mermaid-source={source} className="max-w-full" />
    </figure>
  );
}
