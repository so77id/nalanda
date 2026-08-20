import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { Children, isValidElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import { Step } from './Step';
import type { StepProps } from './Step';

export interface StepShowProps {
  /** The listing shown on the code side, constant across steps. */
  code: string;
  /**
   * Language label the code is written in. Informational — the listing is not
   * syntax-coloured today (`CodeStepper.tsx`).
   */
  language?: string;
  /** Optional heading, rendered above the panels. */
  title?: string;
  /** `<Step>` elements. Order is step order; anything else is ignored. */
  children?: ReactNode;
}

/**
 * Code on one side, arbitrary JSX on the other, both synced to a single step
 * index — the primitive `<MemoryVisual>` sits inside, and other future visuals
 * (call stacks, trees, queues, sequence diagrams) will too.
 *
 * State is scoped to this instance: two `<StepShow>`s on one page step
 * independently. Prev / next / reset control the index; ArrowLeft and
 * ArrowRight walk it from the focused group. Two accessibility invariants are
 * load-bearing and were paid for once (in #116, on the widget this one
 * supersedes): the group is focusable, and prev/next expose `aria-disabled`
 * rather than `disabled`, so the keyboard reader is not stranded when the
 * button that stranded them is the one that just disabled itself.
 *
 * Introduced in #209 as the reversal of ADR-0028: a memory picture used to be
 * drawn from an execution trace (a Java compile + JVM per diagram); it now
 * consumes author-written state through `<MemoryVisual>`, at a fraction of the
 * bundle. The trade-off is documented in the ADR that supersedes 0028.
 */
export function StepShow({ code, language, title, children }: StepShowProps) {
  const steps = Children.toArray(children).filter(
    (child): child is ReactElement<StepProps> => isValidElement(child) && child.type === Step,
  );

  const [index, setIndex] = useState(0);

  if (code === undefined) {
    return (
      <AuthoringError component="StepShow">
        falta la prop <code>code</code>: pásale el listado como una cadena.
      </AuthoringError>
    );
  }

  if (steps.length === 0) {
    return (
      <AuthoringError component="StepShow">
        no encontró ningún <code>&lt;Step&gt;</code> hijo: escribe uno o más{' '}
        <code>&lt;Step lines={'{[1, 2]}'}&gt;…&lt;/Step&gt;</code> dentro para declarar los pasos.
      </AuthoringError>
    );
  }

  const clamped = Math.min(index, steps.length - 1);
  const current = steps[clamped]!;
  const currentLines = current.props.lines ?? [];
  const currentVisual = current.props.children;
  const first = clamped === 0;
  const last = clamped === steps.length - 1;
  const count = steps.length;

  const advance = () => {
    if (!last) setIndex(clamped + 1);
  };
  const retreat = () => {
    if (!first) setIndex(clamped - 1);
  };
  const reset = () => setIndex(0);

  return (
    <div
      // `role="group"` + focusable, so the arrows work from anywhere inside —
      // and keep working at both ends, where the button that had focus is the
      // one that just became unavailable. Earned in #116 by the widget this
      // one supersedes.
      tabIndex={0}
      role="group"
      aria-label="Ejecución paso a paso: usa las flechas izquierda y derecha para recorrer los pasos"
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          advance();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          retreat();
        }
      }}
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          código
        </span>
        {title === undefined ? null : <h4 className="m-0 text-sm font-medium text-ink">{title}</h4>}
      </header>

      {/*
        Stacked, not side by side. Two columns measured wrong inside a document:
        the widget gets ~700px, so each column got ~350 and the drawing scaled
        to ~two-thirds — 11px labels landed near 7px, unreadable on a projector.
        A media query cannot fix it; what is narrow is the container, not the
        viewport. Full width each, both legible. Earned in the widget this
        one supersedes (#116).
      */}
      <div className="flex flex-col gap-px bg-rule">
        <CodeStepper code={code} highlightLines={currentLines} language={language} />
        <div className="max-h-96 overflow-auto bg-surface p-3">{currentVisual}</div>
      </div>

      <footer className="flex items-center gap-2 border-t border-rule bg-sunk px-3 py-2">
        {/*
          `aria-disabled` rather than `disabled`, at both ends. A `disabled`
          button loses focus, so walking to the last step with the keyboard
          threw focus to the body and the reader could no longer walk back —
          the control that stranded them being the one they had just used.
          Announced as unavailable, still focusable, inert on click.
          Earned in #116 by the widget this one supersedes.
        */}
        <button
          type="button"
          aria-label="Paso anterior"
          aria-disabled={first}
          onClick={retreat}
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
          onClick={advance}
          className={`inline-flex items-center rounded border border-rule p-1 text-ink-soft hover:bg-surface ${
            last ? 'opacity-40' : ''
          }`}
        >
          <ChevronRight size={15} />
        </button>
        <button
          type="button"
          aria-label="Reiniciar"
          onClick={reset}
          className="inline-flex items-center rounded border border-rule p-1 text-ink-soft hover:bg-surface"
        >
          <RotateCcw size={13} />
        </button>

        <span className="font-mono text-3xs text-ink-faint">
          paso {clamped + 1} de {count}
        </span>

        {/*
          The counter alone would announce that something changed without
          saying what — for a reader who cannot see the drawing beside the
          code, what changed IS the lesson. Spanish because the page is
          served `lang="es"` (root CLAUDE.md §Language).
        */}
        <span role="status" aria-live="polite" className="sr-only">
          {`Paso ${clamped + 1} de ${count}, ${describeLines(currentLines)}.`}
        </span>
      </footer>
    </div>
  );
}

/**
 * Spanish rendering of the highlighted line set: "línea 6", "líneas 7 y 8",
 * "líneas 1, 4 y 9", "sin línea destacada". Kept as a helper so the test can
 * pin the phrasing rather than the choice of separator.
 */
function describeLines(lines: number[]): string {
  if (lines.length === 0) return 'sin línea destacada';
  const sorted = [...lines].sort((a, b) => a - b);
  if (sorted.length === 1) return `línea ${sorted[0]}`;
  const head = sorted.slice(0, -1).join(', ');
  const tail = sorted[sorted.length - 1];
  return `líneas ${head} y ${tail}`;
}

export { Step } from './Step';
export type { StepProps } from './Step';
