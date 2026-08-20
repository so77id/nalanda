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
 * ArrowRight walk it from the focused group, the same shape `MemoryPlayer`
 * earned in #116 so the keyboard reader is not stranded when the button that
 * stranded them is the one that just disabled itself.
 *
 * This is the primitive #209 replaces `<MemoryDiagram>` with. `<MemoryDiagram>`
 * drew from an execution trace (ADR-0028), which turned out to be more machinery
 * than the pedagogy needed: an author-written state, drawn beside the code, is
 * both cheaper to load and freer in what it can show. The trade-off is
 * documented in the ADR that supersedes 0028 and in this WP's design notes.
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
      // one that just became unavailable (`MemoryPlayer` earned this).
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
        Stacked, not side by side — same reason `MemoryPlayer` stacks: inside a
        document the widget gets ~700px, two columns compress each to ~350 and
        anything wider than that scales to unreadable. A media query cannot
        fix it; what is narrow is the container, not the viewport.
      */}
      <div className="flex flex-col gap-px bg-rule">
        <CodeStepper code={code} highlightLines={currentLines} language={language} />
        <div className="max-h-96 overflow-auto bg-surface p-3">{currentVisual}</div>
      </div>

      <footer className="flex items-center gap-2 border-t border-rule bg-sunk px-3 py-2">
        {/*
          `aria-disabled` rather than `disabled`, at both ends. Same reason
          `MemoryPlayer` earned: a `disabled` button loses focus, so walking to
          the last step with the keyboard threw focus to the body and the reader
          could no longer walk back — the control that stranded them being the
          one they had just used. Announced as unavailable, still focusable,
          inert on click.
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
          Same shape as `MemoryPlayer`: the counter alone announces that
          something changed without saying what. Spanish because the page is
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
