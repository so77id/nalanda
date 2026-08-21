import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import { OUTPUT, Panel } from './Panel';

/**
 * A sub-operation of a for-header: init / cond / inc, each with its own OE
 * cost and execution count. Shown when the reader expands the for row.
 */
export interface SubOperation {
  /** Short label shown next to the sub-op ("init", "cond", "inc"). */
  label: string;
  /** OE cost of this sub-op per execution. */
  oe: number;
  /** Times this sub-op executes, as a symbolic formula in `variable`. */
  times: string;
}

/**
 * One row's worth of annotations, anchored by the code line number.
 *
 * Two shapes:
 *   - a plain line: `{ oe, times }` — the row shows OE × times.
 *   - a for-header: `{ sub: [init, cond, inc] }` — the row collapses under
 *     a chevron; the aggregated total is displayed on the header row and
 *     the individual sub-ops are revealed when the reader expands it.
 *
 * The line number is the key in the parent `annotations` object; lines the
 * author does not annotate simply do not appear in the rail.
 */
export interface LineAnnotation {
  /** OE cost of the line per execution. Ignored on rows that carry `sub`. */
  oe?: number;
  /** Times the line executes, as a symbolic formula. Ignored on rows that carry `sub`. */
  times?: string;
  /**
   * For-header sub-ops. When present, the row is rendered as a collapsible
   * header; `oe` and `times` on the row itself are ignored (the widget
   * computes the aggregated total from the sub-ops).
   */
  sub?: SubOperation[];
}

/**
 * A single case's annotations plus the closed-form T(n).
 */
export interface ComplexityCase {
  /** Line-number → annotation. The key is the 1-based line in `code`. */
  annotations: Record<number, LineAnnotation>;
  /** Final closed form as human-readable string (e.g. "4n + 4"). */
  formula: string;
  /**
   * Numeric evaluator for `formula`, so the widget prints T evaluated at the
   * slider's current value. Declared alongside `formula` — the widget never
   * derives one from the other.
   */
  evaluate: (n: number) => number;
}

export interface ComplexityCounterProps {
  /** Human-readable identifier of the algorithm — shown in the widget header. */
  algorithm?: string;
  /**
   * The full source code shown on the left of the widget, verbatim. Required:
   * annotations are anchored by line number in this code.
   */
  code?: string;
  /** Mode: 'base' one case, 'cases' three tabs (best/worst/average), 'space' same layout but in memory cells. */
  mode?: 'base' | 'cases' | 'space';
  /** For mode = 'base' | 'space': the single case to show. */
  data?: ComplexityCase;
  /** For mode = 'cases': the three cases. */
  cases?: {
    best?: ComplexityCase;
    worst?: ComplexityCase;
    average?: ComplexityCase;
  };
  /** Slider config for the variable N (or M in space mode). */
  slider?: { min?: number; max?: number; default?: number; step?: number };
  /** The variable name shown in formulas. Defaults to 'n'. */
  variable?: string;
  /** Language for CodeStepper's grammar. Defaults to 'java'. */
  language?: string;
}

const DEFAULT_SLIDER = { min: 1, max: 100, default: 10, step: 1 };

/**
 * A widget that makes the process of counting operations visible (ADR-0045).
 *
 * Layout: real `<CodeStepper>` on the left, side rail on the right. Rail rows
 * are anchored to code lines by line number: hovering a line in the editor
 * highlights its annotation, hovering an annotation highlights its line —
 * bidirectional sync driven by `CodeStepper`'s `onLineHover` callback.
 *
 * For-headers collapse by default. The header row shows the aggregated OE
 * total across its sub-ops evaluated at the current slider (`control · 22 OE
 * total`, not the raw `n+1 + n + 1` of the sub-parts). Expanding reveals
 * init / cond / inc as sub-rows for the reader who wants the derivation.
 *
 * Each plain row shows both the symbolic formula and the total OE that line
 * contributes at the current slider value (`2 OE · n = 10 → aporta 20`).
 */
export function ComplexityCounter({
  algorithm,
  code,
  mode = 'base',
  data,
  cases,
  slider,
  variable = 'n',
  language = 'java',
}: ComplexityCounterProps) {
  const sliderCfg = useMemo(
    () => ({
      ...DEFAULT_SLIDER,
      ...(slider ?? {}),
    }),
    [slider],
  );
  const [n, setN] = useState<number>(sliderCfg.default);
  const [caseKey, setCaseKey] = useState<'best' | 'worst' | 'average'>('worst');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [activeLine, setActiveLine] = useState<number | null>(null);

  const active = useMemo<ComplexityCase | undefined>(() => {
    if (mode === 'cases') return cases?.[caseKey];
    return data;
  }, [mode, cases, caseKey, data]);

  if (mode === 'cases' && (cases === undefined || Object.keys(cases).length === 0)) {
    return (
      <AuthoringError component="ComplexityCounter">
        modo <code>cases</code> requiere la prop <code>cases</code> con al menos un caso
        (<code>best</code>, <code>worst</code> o <code>average</code>).
      </AuthoringError>
    );
  }
  if (mode !== 'cases' && data === undefined) {
    return (
      <AuthoringError component="ComplexityCounter">
        falta la prop <code>data</code>: un objeto{' '}
        <code>{'{ annotations, formula, evaluate }'}</code> con las anotaciones por línea, la
        fórmula final y su evaluador numérico.
      </AuthoringError>
    );
  }
  if (active === undefined) {
    return (
      <AuthoringError component="ComplexityCounter">
        el caso <code>{caseKey}</code> no está definido en <code>cases</code>. Los casos
        disponibles se muestran como pestañas; verifica que <code>{caseKey}</code> exista.
      </AuthoringError>
    );
  }
  if (code === undefined || code.trim() === '') {
    return (
      <AuthoringError component="ComplexityCounter">
        falta la prop <code>code</code>: las anotaciones se anclan por número de línea al
        código fuente.
      </AuthoringError>
    );
  }

  const unitLabel = mode === 'space' ? 'celdas' : 'OE';
  const totalLabel = mode === 'space' ? 'M' : 'T';
  const evaluated = active.evaluate(n);
  const codeLines = code.split('\n');
  // Rail rows ordered by line number, only lines the author annotated.
  const annotationEntries = Object.entries(active.annotations)
    .map(([k, v]) => [Number(k), v] as const)
    .sort((a, b) => a[0] - b[0]);

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex flex-wrap items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
          {mode === 'space' ? 'espacio' : 'operaciones'}
        </span>
        {algorithm !== undefined && (
          <span className="font-mono text-sm text-ink">{algorithm}</span>
        )}
      </header>

      {mode === 'cases' && cases !== undefined && (
        <div className="flex border-b border-rule bg-sunk">
          {(['best', 'worst', 'average'] as const).map((k) => {
            if (cases[k] === undefined) return null;
            const label = k === 'best' ? 'mejor' : k === 'worst' ? 'peor' : 'promedio';
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setCaseKey(k);
                  setActiveLine(null);
                  setExpanded(new Set());
                }}
                aria-pressed={k === caseKey}
                className={
                  k === caseKey
                    ? 'border-b-2 border-accent px-3 py-1 text-xs font-medium text-ink'
                    : 'border-b-2 border-transparent px-3 py-1 text-xs text-ink-soft hover:text-ink'
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-3 py-2">
        <label className="flex items-center gap-3 text-xs">
          <span className="font-mono text-ink-soft">{variable} =</span>
          <input
            type="range"
            min={sliderCfg.min}
            max={sliderCfg.max}
            step={sliderCfg.step}
            value={n}
            onChange={(event) => setN(Number(event.target.value))}
            className="flex-1 accent-accent"
            aria-label={`Valor de ${variable}`}
          />
          <span className="min-w-16 text-right font-mono text-ink">{n.toLocaleString('es')}</span>
        </label>
      </div>

      <div className="grid grid-cols-1 border-t border-rule md:grid-cols-[1fr_18rem]">
        <div className="min-w-0 overflow-hidden border-b border-rule md:border-b-0 md:border-r">
          <CodeStepper
            code={code}
            language={language}
            highlightLines={activeLine === null ? [] : [activeLine]}
            onLineHover={setActiveLine}
          />
        </div>
        <ul
          role="list"
          aria-label="Desglose de operaciones por línea"
          className="flex flex-col divide-y divide-rule/50 bg-sunk/30 font-mono text-xs text-ink-soft"
        >
          {annotationEntries.map(([lineNum, ann]) => (
            <RailRow
              key={lineNum}
              lineNum={lineNum}
              lineText={codeLines[lineNum - 1] ?? ''}
              ann={ann}
              variable={variable}
              n={n}
              isActive={activeLine === lineNum}
              isExpanded={expanded.has(lineNum)}
              onToggle={() => {
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(lineNum)) next.delete(lineNum);
                  else next.add(lineNum);
                  return next;
                });
              }}
              onHover={setActiveLine}
              unitLabel={unitLabel}
            />
          ))}
        </ul>
      </div>

      <Panel label={`${totalLabel}(${variable})`}>
        <pre className={`${OUTPUT} bg-sunk text-ink`}>
          {totalLabel}({variable}) = {active.formula}
          {'\n'}
          Para {variable.toUpperCase()} = {n.toLocaleString('es')} → {totalLabel} ={' '}
          {evaluated.toLocaleString('es')} {unitLabel}
        </pre>
      </Panel>
    </div>
  );
}

interface RailRowProps {
  lineNum: number;
  lineText: string;
  ann: LineAnnotation;
  variable: string;
  n: number;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onHover: (line: number | null) => void;
  unitLabel: string;
}

function RailRow({
  lineNum,
  lineText,
  ann,
  variable,
  n,
  isActive,
  isExpanded,
  onToggle,
  onHover,
  unitLabel,
}: RailRowProps) {
  const hoverProps = {
    onMouseEnter: () => onHover(lineNum),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(lineNum),
    onBlur: () => onHover(null),
  };
  const activeClass = isActive ? 'bg-accent-soft/40' : 'hover:bg-accent-soft/20';
  const hasSub = ann.sub !== undefined && ann.sub.length > 0;

  if (hasSub) {
    // For-header: aggregate the sub-ops' contribution and display it as the
    // headline. The sub-ops appear only when expanded.
    const totalOe = ann.sub!.reduce(
      (sum, s) => sum + s.oe * evaluateFormula(s.times, variable, n),
      0,
    );
    return (
      <>
        <li className={`flex items-start gap-2 px-3 py-1.5 ${activeClass}`} {...hoverProps}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Contraer sub-conteos' : 'Expandir sub-conteos'}
            className="mt-0.5 text-ink-faint hover:text-ink"
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-ink">
              <span className="w-6 shrink-0 text-right text-3xs text-ink-faint">
                {lineNum}
              </span>
              <code className="truncate">{lineText.trim()}</code>
            </div>
            <div className="pl-8 text-3xs text-ink-faint">
              control · aporta <span className="text-ink">{totalOe.toLocaleString('es')}</span>{' '}
              {unitLabel} total
            </div>
          </div>
        </li>
        {isExpanded &&
          ann.sub!.map((sub, i) => {
            const times = evaluateFormula(sub.times, variable, n);
            const contrib = sub.oe * times;
            return (
              <li
                key={`sub-${i}`}
                className="flex items-start gap-2 bg-sunk/50 px-3 py-1 pl-11"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-ink-soft">
                    <span className="rounded bg-accent-soft/50 px-1 text-3xs uppercase tracking-wide text-accent">
                      {sub.label}
                    </span>
                    <span className="text-3xs">
                      {sub.oe} {unitLabel} · {sub.times} ={' '}
                      {times.toLocaleString('es')}
                    </span>
                  </div>
                  <div className="text-3xs text-ink-faint">
                    aporta <span className="text-ink">{contrib.toLocaleString('es')}</span>{' '}
                    {unitLabel}
                  </div>
                </div>
              </li>
            );
          })}
      </>
    );
  }

  // Plain row: OE × times → aporte total.
  const oe = ann.oe ?? 0;
  const times = ann.times !== undefined ? evaluateFormula(ann.times, variable, n) : 0;
  const contrib = oe * times;
  return (
    <li className={`flex items-start gap-2 px-3 py-1.5 ${activeClass}`} {...hoverProps}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-ink">
          <span className="w-6 shrink-0 text-right text-3xs text-ink-faint">{lineNum}</span>
          <code className="truncate">{lineText.trim()}</code>
        </div>
        <div className="pl-8 text-3xs text-ink-faint">
          {oe} {unitLabel}
          {ann.times !== undefined && (
            <>
              {' · '}
              {ann.times} = {times.toLocaleString('es')}
              {' → aporta '}
              <span className="text-ink">{contrib.toLocaleString('es')}</span> {unitLabel}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Evaluates a symbolic times-formula. The author writes formulas like `n+1`,
 * `n*(n+1)/2`, `1` — the widget substitutes the variable with the slider
 * value and runs `Function` on the safe arithmetic string. `Function` is
 * used deliberately (not `eval`) so the caller's scope is not visible; the
 * strings all come from the author of the document, not from a reader.
 */
function evaluateFormula(formula: string, variable: string, n: number): number {
  try {
    const trimmed = formula.trim();
    if (trimmed === '') return 0;
    const substituted = trimmed.replace(new RegExp(`\\b${variable}\\b`, 'g'), `(${n})`);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`return (${substituted});`);
    const value = fn() as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
