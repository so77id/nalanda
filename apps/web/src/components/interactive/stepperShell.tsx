import { useCallback, useEffect, useState, type ReactNode, type RefObject } from 'react';

export type StepSpeed = 'slow' | 'normal' | 'fast';

const SPEED_MS: Record<StepSpeed, number> = { slow: 1200, normal: 700, fast: 300 };

export interface UseStepPlaybackOptions {
  totalSteps: number;
  autoplay: boolean;
  speed: StepSpeed;
  /** Ref to the outer element used for IntersectionObserver — playback
   * pauses whenever the widget scrolls out of view (book mode may host
   * many step widgets at once; every one that keeps firing setTimeouts
   * contributes to freezing the tab). */
  visibilityRef: RefObject<HTMLElement | null>;
  /** Values that reset playback to step 0 when they change (input array,
   * algorithm choice…). */
  resetKey: string;
}

export interface StepPlayback {
  stepIndex: number;
  isPlaying: boolean;
  liveSpeed: StepSpeed;
  setLiveSpeed: (s: StepSpeed) => void;
  advance: () => void;
  rewind: () => void;
  reset: () => void;
  togglePlay: () => void;
  /** Visibility of the widget in the viewport — surfaced so callers can e.g.
   * ARIA-suppress or gate expensive draws when the widget is off-screen. */
  isVisible: boolean;
}

/**
 * Shared playback machinery for step-through widgets — the same shape
 * `<SortStepper>` and `<StepShow>` use. Autoplay off by default (rule
 * Peli 1/2). Pauses when the widget is off-screen. Resets when `resetKey`
 * changes (e.g. the author swaps the input array).
 */
export function useStepPlayback({
  totalSteps,
  autoplay,
  speed,
  visibilityRef,
  resetKey,
}: UseStepPlaybackOptions): StepPlayback {
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [liveSpeed, setLiveSpeed] = useState<StepSpeed>(speed);
  useEffect(() => setLiveSpeed(speed), [speed]);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(autoplay);
  }, [resetKey, autoplay]);

  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const el = visibilityRef.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibilityRef]);

  useEffect(() => {
    if (!isPlaying) return;
    if (!isVisible) return;
    if (totalSteps === 0) return;
    if (stepIndex >= totalSteps - 1) {
      setIsPlaying(false);
      return;
    }
    const delay = SPEED_MS[liveSpeed];
    const timeout = window.setTimeout(() => setStepIndex((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, isVisible, stepIndex, liveSpeed, totalSteps]);

  const advance = useCallback(() => {
    setStepIndex((s) => Math.min(s + 1, totalSteps - 1));
  }, [totalSteps]);
  const rewind = useCallback(() => {
    setStepIndex((s) => Math.max(s - 1, 0));
  }, []);
  const reset = useCallback(() => {
    setStepIndex(0);
    setIsPlaying(false);
  }, []);
  const togglePlay = useCallback(() => {
    if (stepIndex >= totalSteps - 1) {
      setStepIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  }, [stepIndex, totalSteps]);

  return {
    stepIndex,
    isPlaying,
    liveSpeed,
    setLiveSpeed,
    advance,
    rewind,
    reset,
    togglePlay,
    isVisible,
  };
}

// ── Presentational primitives ────────────────────────────────────────────
//
// All three widgets in the family (`SortStepper`, `MergeStepper`,
// `PartitionStepper`) render the same shell: an outer card with a header
// (kind chip + title + big step counter + progress bar), one or more panels
// with a numbered PanelLabel, a narration strip, and a controls row. The
// helpers here paint each of those pieces so the widgets themselves are
// mostly composition — and any visual tweak to the family only touches one
// file.

export interface StepperHeaderProps {
  /** Short uppercase label the reader identifies the widget by, e.g.
   * "sort · mergesort" or "op · merge". Rendered in the accent chip. */
  kind: string;
  title?: string;
  stepIndex: number;
  totalSteps: number;
}

/**
 * The card's top strip. Left: kind chip + title. Right: the big monospaced
 * step counter (paso N / M) plus a slim progress bar. The counter is the
 * reader's anchor for "where are we in the algo run" (ANCLA · qué
 * significa).
 */
export function StepperHeader({ kind, title, stepIndex, totalSteps }: StepperHeaderProps) {
  const progressPct = totalSteps > 1 ? ((stepIndex + 1) / totalSteps) * 100 : 100;
  return (
    <header className="flex items-center justify-between gap-3 bg-sunk px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          {kind}
        </span>
        {title === undefined ? null : <h4 className="m-0 text-sm font-medium text-ink">{title}</h4>}
      </div>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-xs text-ink-faint">paso</span>
        <span className="font-mono text-lg font-bold leading-none text-ink">
          {stepIndex + 1}
          <span className="font-medium text-ink-faint"> / {totalSteps}</span>
        </span>
        <div
          className="h-2 w-24 overflow-hidden rounded border border-rule bg-surface"
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
        >
          <div
            className="h-full rounded-sm bg-accent-pop transition-[width] duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * Numbered panel header. The filled accent badge makes the reader's
 * scanning order explicit — 1, 2, 3 across the presentation grid. An
 * optional `hint` (right-aligned) names the sub-context of the panel: the
 * active code line, the current merge / partition annotation, etc.
 */
export function PanelLabel({
  index,
  label,
  hint,
}: {
  index: number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-rule bg-sunk px-3 py-1.5 font-mono text-3xs uppercase tracking-wide text-ink-faint">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-accent font-bold text-on-accent">
        {index}
      </span>
      <span className="font-bold text-ink-soft">{label}</span>
      {hint ? (
        <span className="ml-auto truncate normal-case tracking-normal text-ink-faint">{hint}</span>
      ) : null}
    </div>
  );
}

/**
 * The "qué está pasando" narration strip — turquoise chip + a single line
 * of Spanish that names what the current step is doing. Pedagogical anchor:
 * a verbal frame every reader can hold onto while scanning the visual.
 */
export function NarrationStrip({ text }: { text: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-rule bg-sunk px-3 py-2">
      <span className="rounded border border-focus/40 bg-focus/10 px-2 py-0.5 font-mono text-3xs font-bold tracking-wide text-focus uppercase whitespace-nowrap">
        qué está pasando
      </span>
      <p className="m-0 font-mono text-xs text-ink">{text}</p>
    </div>
  );
}

export function ControlButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  // aria-disabled + guarded onClick (never native `disabled`) so a keyboard
  // reader who clicked "skip forward" on the last step is not stranded on the
  // button that just disabled itself. Invariant earned in #116 for StepShow;
  // shared here so every stepper composed on this shell inherits it.
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
      className="inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink hover:bg-accent-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {children}
      {label}
    </button>
  );
}

export function LegendSwatch({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded-sm border ${swatchClass}`} />
      {label}
    </span>
  );
}
