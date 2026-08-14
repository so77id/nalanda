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
 * other listing on the site uses. The reason that holds is the line highlight:
 * driving the editor's decorations from outside it is awkward, and the highlight
 * IS the content here.
 *
 * The weight argument is smaller than it looks and is recorded so nobody repeats
 * it as gospel: ADR-0018's ~162 kB gzip is measured against a page with no
 * runtime, but a mounted diagram already pulls the CodeMirror core through the
 * java runtime module, so the editor would add only ~37 kB gzip on top
 * (ADR-0028 §9). The cost of the trade is a listing with no syntax colour.
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
      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
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
      {/*
        Stacked, not side by side. Two columns looked right and measured wrong:
        inside a document the component gets around 700px, so each column got
        ~350 while the drawing's own viewBox is wider than that — it scaled to
        about two thirds and the 11px labels landed near 7px, which is not
        readable on a projector. A media query cannot fix it either, since what
        is narrow is the container and not the viewport. Full width each, and
        both are legible.
      */}
      <div className="flex flex-col gap-px bg-rule">
        <div className="bg-surface">
          <pre className={`${OUTPUT} max-h-72 text-ink-soft`}>
            {lines.map((line, number) => {
              const active = number + 1 === current.line;
              return (
                <div
                  key={number}
                  data-active={active}
                  className={`flex gap-3 px-1 ${active ? 'bg-keep-soft text-ink' : ''}`}
                >
                  <span className="w-6 shrink-0 text-right text-ink-faint select-none">
                    {number + 1}
                  </span>
                  <span className="whitespace-pre">{line === '' ? ' ' : line}</span>
                </div>
              );
            })}
          </pre>
        </div>

        <div className="max-h-96 overflow-auto bg-surface p-3">
          <MemoryState step={current} changed={changed} />
        </div>
      </div>

      {/*
        Three walls, one question: is this everything? Whichever one the run hit,
        the reader has to be told — the counter below says "paso N de N", and
        that is an active claim of completeness. Measured in Chromium before this
        existed: a 30-node list drew 24 boxes in silence, and a 40-photograph run
        cut by the launcher's byte budget announced "paso 21 de 21".
      */}
      {truncated === null ? null : (
        <Panel label="aviso">
          <p className="m-0 px-3 py-2 font-mono text-xs text-flag">
            {truncated === 'pasos'
              ? 'Se alcanzó el máximo de fotos: el diagrama muestra sólo las primeras.'
              : truncated === 'objetos'
                ? 'Hay más objetos de los que caben en el dibujo: se muestran los primeros, y alguna flecha queda sin destino.'
                : 'El programa imprimió demasiado y la traza se cortó: faltan fotos al final.'}
          </p>
        </Panel>
      )}

      <footer className="flex items-center gap-2 border-t border-rule bg-sunk px-3 py-2">
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
          className={`inline-flex items-center rounded border border-rule p-1 text-ink-soft hover:bg-surface ${
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
          className={`inline-flex items-center rounded border border-rule p-1 text-ink-soft hover:bg-surface ${
            last ? 'opacity-40' : ''
          }`}
        >
          <ChevronRight size={15} />
        </button>

        <span className="font-mono text-3xs text-ink-faint">
          paso {index + 1} de {steps.length}
        </span>
        <span className="font-mono text-3xs text-ink-faint">línea {current.line}</span>

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
