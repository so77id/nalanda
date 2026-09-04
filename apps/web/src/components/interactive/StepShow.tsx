import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { Children, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { useMode } from '../../presentation';
import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import { Step } from './Step';
import type { StepProps } from './Step';
import { useViewportBreakout } from './useViewportBreakout';

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
  /**
   * Start playing on mount. Default `false` — pedagogical widgets should not
   * autoplay unless the author explicitly asks. Matches `<SortStepper>`
   * behaviour (rule Peli 1/2). When true, playback still pauses when the
   * widget scrolls out of view.
   */
  autoplay?: boolean;
  /**
   * Playback speed. `slow` ≈ 1200ms/step, `normal` ≈ 700ms, `fast` ≈ 300ms.
   * Default `normal`. The reader can override in the UI.
   */
  speed?: 'slow' | 'normal' | 'fast';
  /** `<Step>` elements. Order is step order; anything else is ignored. */
  children?: ReactNode;
}

const SPEED_MS: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 1200,
  normal: 700,
  fast: 300,
};

/**
 * Code on one side, arbitrary JSX on the other, both synced to a single step
 * index — the primitive `<MemoryVisual>` sits inside, and every other
 * step-based widget (the Fibonacci trio, `<MergeStepper>`, `<PartitionStepper>`)
 * builds on top.
 *
 * State is scoped to this instance: two `<StepShow>`s on one page step
 * independently. Controls: skip-back / skip-forward / play-pause / reset,
 * plus a speed selector — same shape as `<SortStepper>` so the reader learns
 * one control layout that works across the site. ArrowLeft / ArrowRight also
 * walk the index from the focused group.
 *
 * Two accessibility invariants are load-bearing and were paid for once
 * (in #116, on the widget this one supersedes): the group is focusable, and
 * skip / play controls expose `aria-disabled` rather than `disabled`, so the
 * keyboard reader is not stranded when the button that stranded them is the
 * one that just disabled itself.
 *
 * Playback pauses when the widget scrolls out of view — a book-mode reader
 * often has many step widgets on one page, and every one that keeps firing
 * setTimeouts contributes to freezing the tab.
 *
 * Introduced in #209 as the reversal of ADR-0028: a memory picture used to be
 * drawn from an execution trace (a Java compile + JVM per diagram); it now
 * consumes author-written state through `<MemoryVisual>`, at a fraction of the
 * bundle. Play controls added in #268 so `<MergeStepper>` and
 * `<PartitionStepper>` — and the Fibonacci trio — get the same playback UX
 * as `<SortStepper>` without duplicating the machinery.
 */
export function StepShow({
  code,
  language,
  title,
  autoplay = false,
  speed = 'normal',
  children,
}: StepShowProps) {
  const steps = Children.toArray(children).filter(
    (child): child is ReactElement<StepProps> => isValidElement(child) && child.type === Step,
  );

  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [liveSpeed, setLiveSpeed] = useState<'slow' | 'normal' | 'fast'>(speed);
  useEffect(() => setLiveSpeed(speed), [speed]);

  // In presentation the widget breaks out of the Slide's prose max-width
  // and takes 75 % of the viewport — same rationale as `<SortStepper>` with
  // no tree: enough for code + panel side-by-side, but not the visual bloat
  // of an empty third of screen. Book mode leaves it alone. The measurement
  // dance is shared with `<SortStepper>` (`useViewportBreakout`).
  const mode = useMode();
  const isPresentation = mode === 'presentation';

  // Pause playback when the widget is not intersecting the viewport. Book
  // mode may host many step widgets on one page; without this, every one
  // that has been played and left mid-run keeps firing setTimeouts and their
  // combined tick rate can lock the tab.
  const outerRef = useRef<HTMLDivElement | null>(null);
  useViewportBreakout(outerRef, {
    enabled: isPresentation,
    fraction: 0.75,
  });
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const el = outerRef.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const count = steps.length;
  const clamped = Math.min(index, Math.max(count - 1, 0));

  useEffect(() => {
    if (!isPlaying) return;
    if (!isVisible) return;
    if (count === 0) return;
    if (clamped >= count - 1) {
      setIsPlaying(false);
      return;
    }
    const delay = SPEED_MS[liveSpeed];
    const timeout = window.setTimeout(() => setIndex((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, isVisible, clamped, liveSpeed, count]);

  const advance = useCallback(() => {
    setIndex((s) => Math.min(s + 1, count - 1));
  }, [count]);
  const retreat = useCallback(() => {
    setIndex((s) => Math.max(s - 1, 0));
  }, []);
  const reset = useCallback(() => {
    setIndex(0);
    setIsPlaying(false);
  }, []);
  const togglePlay = useCallback(() => {
    if (clamped >= count - 1) {
      setIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  }, [clamped, count]);

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
        no encontró ningún <code>&lt;Step&gt;</code> hijo directo: escribe uno o más{' '}
        <code>&lt;Step lines={'{[1, 2]}'}&gt;…&lt;/Step&gt;</code> dentro para declarar los pasos.
        Si los envolviste en un fragmento <code>&lt;&gt;…&lt;/&gt;</code>, sácalos: los{' '}
        <code>&lt;Step&gt;</code> tienen que ser hijos directos.
      </AuthoringError>
    );
  }

  const current = steps[clamped]!;
  const currentLines = current.props.lines ?? [];
  const currentVisual = current.props.children;
  const first = clamped === 0;
  const last = clamped === count - 1;

  return (
    <div
      ref={outerRef}
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

      {/*
        Controls row — same shape as `<SortStepper>`: skip-back, skip-forward,
        play/pause, reset, speed, counter. `aria-disabled` rather than
        `disabled`, at both ends (a `disabled` button loses focus, so walking
        to the last step with the keyboard threw focus to the body and the
        reader could no longer walk back — the control that stranded them
        being the one they had just used). Announced as unavailable, still
        focusable, inert on click. Earned in #116.
      */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-2">
        <ControlButton onClick={retreat} disabled={first} label="Paso anterior">
          <SkipBack size={14} aria-hidden />
        </ControlButton>
        <ControlButton onClick={advance} disabled={last} label="Paso siguiente">
          <SkipForward size={14} aria-hidden />
        </ControlButton>
        <ControlButton onClick={togglePlay} label={isPlaying ? 'Pausar' : 'Reproducir'}>
          {isPlaying ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        </ControlButton>
        <ControlButton onClick={reset} label="Reiniciar">
          <RotateCcw size={13} aria-hidden />
        </ControlButton>
        <label className="ml-1 inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink">
          <span className="font-mono text-3xs text-ink-faint uppercase tracking-wide">
            velocidad
          </span>
          <select
            value={liveSpeed}
            onChange={(e) => setLiveSpeed(e.target.value as 'slow' | 'normal' | 'fast')}
            className="bg-transparent outline-none text-xs text-ink"
            aria-label="Velocidad de reproducción"
          >
            <option value="slow">lenta</option>
            <option value="normal">normal</option>
            <option value="fast">rápida</option>
          </select>
        </label>

        <span className="ml-auto font-mono text-3xs text-ink-faint">
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

function ControlButton({
  onClick,
  disabled = false,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`inline-flex items-center rounded border border-rule bg-surface p-1 text-ink-soft hover:bg-surface ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      {children}
    </button>
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
