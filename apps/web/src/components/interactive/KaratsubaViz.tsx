import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';

export interface KaratsubaSplit {
  /** Digit width used for the split; pow10m = 10^m. */
  m: number;
  pow10m: number;
  xHi: number;
  xLo: number;
  yHi: number;
  yLo: number;
}

/** One row the widget reveals; the `body` is a small piece of Karatsuba prose
 * with math already computed. Every step points at one row (or a few) that
 * become visible/highlighted when that step is current. */
export interface KaratsubaStep {
  kind:
    | 'intro'
    | 'split'
    | 'naive-expand'
    | 'pivot'
    | 'p1'
    | 'p2'
    | 'p3'
    | 'middle-formula'
    | 'middle-compute'
    | 'reconstruct-formula'
    | 'reconstruct-compute'
    | 'winner';
  /** Text of the row that this step ADDS to the reveal panel. */
  reveal: string;
  /** Group of prior rows this step visually belongs to. */
  section: 'setup' | 'naive' | 'karatsuba' | 'reconstruct' | 'winner';
  description: string;
  highlightLines: number[];
}

export interface KaratsubaTrace {
  split: KaratsubaSplit;
  p1: number;
  p2: number;
  p3: number;
  middle: number;
  result: number;
  steps: KaratsubaStep[];
}

const CODE = `long karatsuba(long x, long y, int n) {
    if (n <= 1) return x * y;
    int m = n / 2;
    long xHi = x / pow10(m), xLo = x % pow10(m);
    long yHi = y / pow10(m), yLo = y % pow10(m);

    long P1 = karatsuba(xHi, yHi, n - m);
    long P2 = karatsuba(xLo, yLo, m);
    long P3 = karatsuba(xHi + xLo, yHi + yLo, m + 1);

    long middle = P3 - P1 - P2;

    return P1 * pow10(2*m) + middle * pow10(m) + P2;
}`;

const LINE = {
  BASE: 2,
  M: 3,
  SPLIT_X: 4,
  SPLIT_Y: 5,
  P1: 7,
  P2: 8,
  P3: 9,
  MIDDLE: 11,
  RETURN: 13,
} as const;

/** Number of decimal digits in a non-negative integer. */
function digits(n: number): number {
  if (n === 0) return 1;
  return Math.floor(Math.log10(n)) + 1;
}

/**
 * Pure Karatsuba step-by-step at the OUTER level. Does not recurse visually:
 * the three subproducts (P1, P2, P3) are shown as concrete values, and the
 * abstract recursion is left to `<RecursionTreeDivide recipe="karatsuba">`
 * which sits beside this widget in the deck (ADR-0061).
 */
export function tracesKaratsuba(x: number, y: number): KaratsubaTrace {
  const n = Math.max(digits(x), digits(y), 1);
  const m = Math.max(1, Math.ceil(n / 2));
  const pow10m = 10 ** m;
  const xHi = Math.floor(x / pow10m);
  const xLo = x % pow10m;
  const yHi = Math.floor(y / pow10m);
  const yLo = y % pow10m;

  const p1 = xHi * yHi;
  const p2 = xLo * yLo;
  const p3 = (xHi + xLo) * (yHi + yLo);
  const middle = p3 - p1 - p2;
  const result = p1 * 10 ** (2 * m) + middle * pow10m + p2;

  const steps: KaratsubaStep[] = [];

  steps.push({
    kind: 'intro',
    section: 'setup',
    reveal: `${x} × ${y} = ?`,
    description: `Objetivo: multiplicar ${x} × ${y} usando Karatsuba.`,
    highlightLines: [],
  });

  // Base case shortcut for tiny inputs where the split is trivial.
  if (n <= 1) {
    steps.push({
      kind: 'winner',
      section: 'winner',
      reveal: `${x} × ${y} = ${result}`,
      description: `Caso base (${n} dígito): multiplicar directo, ${x} × ${y} = ${result}.`,
      highlightLines: [LINE.BASE],
    });
    return { split: { m, pow10m, xHi, xLo, yHi, yLo }, p1, p2, p3, middle, result, steps };
  }

  steps.push({
    kind: 'split',
    section: 'setup',
    reveal: `Split m = ${m} · 10^m = ${pow10m}`,
    description: `Elegir m = ⌈n/2⌉ = ${m}. Cada número se parte en dos mitades de ~m dígitos.`,
    highlightLines: [LINE.M],
  });
  steps.push({
    kind: 'split',
    section: 'setup',
    reveal: `${x} = ${xHi}·${pow10m} + ${xLo}`,
    description: `x = xHi·10^m + xLo = ${xHi}·${pow10m} + ${xLo}.`,
    highlightLines: [LINE.SPLIT_X],
  });
  steps.push({
    kind: 'split',
    section: 'setup',
    reveal: `${y} = ${yHi}·${pow10m} + ${yLo}`,
    description: `y = yHi·10^m + yLo = ${yHi}·${pow10m} + ${yLo}.`,
    highlightLines: [LINE.SPLIT_Y],
  });

  steps.push({
    kind: 'naive-expand',
    section: 'naive',
    reveal: `Escolar: (xHi·10^m + xLo)(yHi·10^m + yLo)`,
    description: `Producto ingenuo: expandir el paréntesis da CUATRO sub-productos.`,
    highlightLines: [],
  });
  steps.push({
    kind: 'naive-expand',
    section: 'naive',
    reveal: `  = xHi·yHi·10^{2m} + xHi·yLo·10^m + xLo·yHi·10^m + xLo·yLo`,
    description: `Cuatro productos: xHi·yHi, xHi·yLo, xLo·yHi, xLo·yLo. Complejidad T(n) = 4T(n/2) + O(n) = O(n^2).`,
    highlightLines: [],
  });

  steps.push({
    kind: 'pivot',
    section: 'karatsuba',
    reveal: `Karatsuba (1960): con 3 productos + álgebra basta.`,
    description: `Refutando la conjetura de Kolmogórov: podemos evitar uno de los cuatro productos con un truco algebraico.`,
    highlightLines: [],
  });

  steps.push({
    kind: 'p1',
    section: 'karatsuba',
    reveal: `P1 = xHi × yHi = ${xHi} × ${yHi} = ${p1}   ← ac`,
    description: `Primer producto: P1 = xHi·yHi = ${xHi}·${yHi} = ${p1}.`,
    highlightLines: [LINE.P1],
  });
  steps.push({
    kind: 'p2',
    section: 'karatsuba',
    reveal: `P2 = xLo × yLo = ${xLo} × ${yLo} = ${p2}   ← bd`,
    description: `Segundo producto: P2 = xLo·yLo = ${xLo}·${yLo} = ${p2}.`,
    highlightLines: [LINE.P2],
  });
  steps.push({
    kind: 'p3',
    section: 'karatsuba',
    reveal: `P3 = (xHi + xLo) × (yHi + yLo) = ${xHi + xLo} × ${yHi + yLo} = ${p3}   ← (a+b)(c+d)`,
    description: `Tercer producto — el truco: P3 = (xHi+xLo)·(yHi+yLo) = ${xHi + xLo}·${yHi + yLo} = ${p3}.`,
    highlightLines: [LINE.P3],
  });

  steps.push({
    kind: 'middle-formula',
    section: 'karatsuba',
    reveal: `middle = P3 − P1 − P2 = (a+b)(c+d) − ac − bd = ad + bc`,
    description: `Álgebra: (a+b)(c+d) = ac + ad + bc + bd. Restar ac (P1) y bd (P2) deja ad + bc — lo que necesitábamos.`,
    highlightLines: [LINE.MIDDLE],
  });
  steps.push({
    kind: 'middle-compute',
    section: 'karatsuba',
    reveal: `middle = ${p3} − ${p1} − ${p2} = ${middle}`,
    description: `Sustituir: middle = ${p3} − ${p1} − ${p2} = ${middle}.`,
    highlightLines: [LINE.MIDDLE],
  });

  steps.push({
    kind: 'reconstruct-formula',
    section: 'reconstruct',
    reveal: `x × y = P1·10^{2m} + middle·10^m + P2`,
    description: `Reconstruir el producto con los tres valores.`,
    highlightLines: [LINE.RETURN],
  });
  steps.push({
    kind: 'reconstruct-compute',
    section: 'reconstruct',
    reveal: `= ${p1}·${10 ** (2 * m)} + ${middle}·${pow10m} + ${p2}`,
    description: `Sustituir: ${p1}·${10 ** (2 * m)} + ${middle}·${pow10m} + ${p2}.`,
    highlightLines: [LINE.RETURN],
  });
  steps.push({
    kind: 'reconstruct-compute',
    section: 'reconstruct',
    reveal: `= ${p1 * 10 ** (2 * m)} + ${middle * pow10m} + ${p2}`,
    description: `Evaluar cada término.`,
    highlightLines: [LINE.RETURN],
  });

  steps.push({
    kind: 'winner',
    section: 'winner',
    reveal: `${x} × ${y} = ${result}   ✓`,
    description: `Resultado: ${x} × ${y} = ${result}. Karatsuba lo obtuvo con 3 productos en vez de 4 — a nivel asintótico, T(n) = 3T(n/2) + O(n) ⇒ Θ(n^log_2 3) ≈ Θ(n^1.585).`,
    highlightLines: [LINE.RETURN],
  });

  return { split: { m, pow10m, xHi, xLo, yHi, yLo }, p1, p2, p3, middle, result, steps };
}

// ── Widget ──────────────────────────────────────────────────────────────────

export interface KaratsubaVizProps {
  x?: number;
  y?: number;
  title?: string;
  speed?: number;
  autoplay?: boolean;
}

export function KaratsubaViz({ x, y, title, speed = 1, autoplay = false }: KaratsubaVizProps) {
  if (x === undefined || y === undefined) {
    return (
      <AuthoringError component="KaratsubaViz">
        faltan las props <code>x</code> y/o <code>y</code> (enteros positivos).
      </AuthoringError>
    );
  }
  if (!Number.isInteger(x) || !Number.isInteger(y) || x <= 0 || y <= 0) {
    return (
      <AuthoringError component="KaratsubaViz">
        <code>x</code> y <code>y</code> tienen que ser enteros positivos.
      </AuthoringError>
    );
  }

  return <Body x={x} y={y} title={title} speed={speed} autoplay={autoplay} />;
}

interface BodyProps {
  x: number;
  y: number;
  title?: string;
  speed: number;
  autoplay: boolean;
}

function Body({ x, y, title, speed, autoplay }: BodyProps) {
  // Memoise the trace on the primitive inputs. If we called `tracesKaratsuba`
  // in the outer component's render body (as the pre-review code did), every
  // parent re-render passed a fresh object into Body and the reset effect
  // below snapped stepIndex back to 0 mid-run.
  const trace = useMemo(() => tracesKaratsuba(x, y), [x, y]);
  const totalSteps = trace.steps.length;

  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(autoplay);
  }, [trace, autoplay]);

  useEffect(() => {
    if (!isPlaying) return;
    if (stepIndex >= totalSteps - 1) {
      setIsPlaying(false);
      return;
    }
    const delay = 900 / Math.max(0.25, speed);
    const timeout = window.setTimeout(() => setStepIndex((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, stepIndex, speed, totalSteps]);

  const step = trace.steps[stepIndex]!;
  const isFinal = stepIndex === totalSteps - 1;
  const visibleSteps = trace.steps.slice(0, stepIndex + 1);

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

  const heading = title ?? `Karatsuba · ${x} × ${y}`;

  return (
    <figure
      data-widget="karatsuba-viz"
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          karat
        </span>
        <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
      </header>

      <div className="border-b border-rule">
        <CodeStepper code={CODE} highlightLines={step.highlightLines} language="java" />
      </div>

      <div className="overflow-x-auto px-3 py-3 font-mono text-xs text-ink">
        <RevealPanel steps={visibleSteps} currentIndex={stepIndex} />
      </div>

      <div className="border-t border-rule bg-sunk px-3 py-2 text-sm text-ink">
        <p className="m-0 font-mono text-xs">
          <span className="text-ink-faint">
            Paso {stepIndex + 1}/{totalSteps} ·{' '}
          </span>
          {step.description}
        </p>
        {isFinal ? (
          <p className="m-0 mt-1 font-mono text-xs">
            <span className="text-keep">✓ </span>
            <strong>
              {`${x} × ${y} = ${trace.result} — 3 productos (P1, P2, P3) en vez de 4.`}
            </strong>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-1.5">
        <ControlButton onClick={rewind} disabled={stepIndex === 0} label="Atrás">
          <SkipBack size={14} aria-hidden />
        </ControlButton>
        <ControlButton onClick={advance} disabled={stepIndex >= totalSteps - 1} label="Paso">
          <SkipForward size={14} aria-hidden />
        </ControlButton>
        <ControlButton onClick={togglePlay} label={isPlaying ? 'Pausa' : 'Play'}>
          {isPlaying ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        </ControlButton>
        <ControlButton onClick={reset} label="Reset">
          <RotateCcw size={14} aria-hidden />
        </ControlButton>
      </div>
    </figure>
  );
}

interface RevealPanelProps {
  steps: KaratsubaStep[];
  currentIndex: number;
}

function RevealPanel({ steps, currentIndex }: RevealPanelProps) {
  // Group consecutive same-section rows so the panel reads as blocks
  // (setup / naive / karatsuba / reconstruct / winner) rather than as a flat
  // list. Section separators are drawn between groups.
  const sections: {
    section: KaratsubaStep['section'];
    rows: { text: string; isCurrent: boolean }[];
  }[] = [];
  steps.forEach((s, i) => {
    const last = sections[sections.length - 1];
    if (last === undefined || last.section !== s.section) {
      sections.push({ section: s.section, rows: [] });
    }
    sections[sections.length - 1]!.rows.push({
      text: s.reveal,
      isCurrent: i === currentIndex,
    });
  });

  return (
    <div className="flex min-w-fit flex-col gap-2 whitespace-pre">
      {sections.map((sec, i) => (
        <div key={i} className="rounded border border-rule/50 bg-sunk/40 px-3 py-1.5">
          <div className="mb-1 text-3xs tracking-wide text-ink-faint uppercase">
            {SECTION_LABEL[sec.section]}
          </div>
          {sec.rows.map((r, j) => (
            <div
              key={j}
              data-reveal-line
              className={r.isCurrent ? 'text-accent font-medium' : 'text-ink'}
            >
              {r.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const SECTION_LABEL: Record<KaratsubaStep['section'], string> = {
  setup: 'Split',
  naive: 'Escolar (4 productos)',
  karatsuba: 'Karatsuba (3 productos + álgebra)',
  reconstruct: 'Reconstrucción',
  winner: 'Resultado',
};

interface ControlButtonProps {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}

function ControlButton({ onClick, disabled, label, children }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {children}
      {label}
    </button>
  );
}
