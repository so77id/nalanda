import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { TraceCap, TraceStep } from './trace';
import { describeStep } from './memoryLayout';
import { MemoryState } from './MemoryState';
import { OUTPUT, Panel } from './Panel';

export interface MemoryPlayerProps {
  steps: TraceStep[];
  /** The snippet as the author wrote it, markers already removed. */
  source: string;
  truncated?: TraceCap | null;
}

/** Object ids whose contents differ between two photographs. */
function changedBetween(before: TraceStep | undefined, after: TraceStep): number[] {
  if (before === undefined) return [];
  const shapeOf = (step: TraceStep, id: number) =>
    JSON.stringify(step.objects.find((one) => one.id === id)?.fields ?? null);

  return after.objects
    .filter((one) => shapeOf(before, one.id) !== shapeOf(after, one.id))
    .map((one) => one.id);
}

/**
 * Walks the reader through the photographs, with the line that produced each one
 * marked in the source.
 *
 * The listing is rendered here rather than through `CodeEditor`, which every
 * other listing on the site uses. Two reasons, and the trade is deliberate: the
 * editor's line decorations would have to be driven from outside it, and it
 * pulls ~162 kB gzip of CodeMirror (ADR-0018) for a listing nobody can edit. The
 * cost is that this listing is not syntax-coloured — acceptable where the
 * highlight IS the content, and where the reader's attention belongs on the
 * drawing beside it.
 */
export function MemoryPlayer({ steps, source, truncated = null }: MemoryPlayerProps) {
  const [index, setIndex] = useState(0);
  const lines = useMemo(() => source.split('\n'), [source]);

  if (steps.length === 0) return null;

  const current = steps[Math.min(index, steps.length - 1)]!;
  const changed = changedBetween(steps[index - 1], current);
  const first = index === 0;
  const last = index === steps.length - 1;

  return (
    <div
      // A focusable group, so the arrows work without having to click a button
      // first — and so they keep working at both ends, where the button that
      // had focus is the one that just became unavailable.
      tabIndex={0}
      role="group"
      aria-label="Diagrama de memoria: usa las flechas izquierda y derecha para recorrer los pasos"
      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' && !last) {
          event.preventDefault();
          setIndex(index + 1);
        }
        if (event.key === 'ArrowLeft' && !first) {
          event.preventDefault();
          setIndex(index - 1);
        }
      }}
    >
      <div className="grid gap-px bg-zinc-700 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="bg-zinc-900">
          <pre className={`${OUTPUT} max-h-80 text-zinc-300`}>
            {lines.map((line, number) => {
              const active = number + 1 === current.line;
              return (
                <div
                  key={number}
                  data-active={active}
                  className={`flex gap-3 px-1 ${active ? 'bg-emerald-900/40 text-zinc-100' : ''}`}
                >
                  <span className="w-6 shrink-0 text-right text-zinc-600 select-none">
                    {number + 1}
                  </span>
                  <span className="whitespace-pre">{line === '' ? ' ' : line}</span>
                </div>
              );
            })}
          </pre>
        </div>

        <div className="flex items-center bg-zinc-900 p-2">
          <MemoryState step={current} changed={changed} />
        </div>
      </div>

      {truncated === null ? null : (
        <Panel label="aviso">
          <p className="m-0 px-3 py-2 font-mono text-xs text-amber-300">
            {truncated === 'pasos'
              ? 'Se alcanzó el máximo de fotos: el diagrama muestra sólo las primeras.'
              : 'Se alcanzó el máximo de objetos: el diagrama no los muestra todos.'}
          </p>
        </Panel>
      )}

      <footer className="flex items-center gap-2 border-t border-zinc-700 bg-zinc-800 px-3 py-2">
        {/*
          `aria-disabled` rather than `disabled`, at both ends. A disabled button
          cannot hold focus, so walking to the last step with the keyboard threw
          the focus to the body and the reader could no longer walk back — the
          control that stranded them being the one they had just used. Announced
          as unavailable, still focusable, and inert on click.
        */}
        <button
          type="button"
          aria-label="Paso anterior"
          aria-disabled={first}
          onClick={() => {
            if (!first) setIndex(index - 1);
          }}
          className={`inline-flex items-center rounded bg-zinc-700 p-1 text-zinc-200 ${
            first ? 'opacity-40' : ''
          }`}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          aria-label="Paso siguiente"
          aria-disabled={last}
          onClick={() => {
            if (!last) setIndex(index + 1);
          }}
          className={`inline-flex items-center rounded bg-zinc-700 p-1 text-zinc-200 ${
            last ? 'opacity-40' : ''
          }`}
        >
          <ChevronRight size={15} />
        </button>

        <span className="font-mono text-3xs text-zinc-400">
          paso {index + 1} de {steps.length}
        </span>
        <span className="font-mono text-3xs text-zinc-500">línea {current.line}</span>

        {/*
          The counter alone would announce that something changed without saying
          what — and for a reader who cannot see the drawing, what changed IS the
          lesson. Spanish because the page is served lang="es" (root CLAUDE.md).
        */}
        <span role="status" aria-live="polite" className="sr-only">
          {`Paso ${index + 1} de ${steps.length}, línea ${current.line}. ${describeStep(current)}`}
        </span>
      </footer>
    </div>
  );
}
