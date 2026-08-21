import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import { OUTPUT, Panel } from './Panel';

/**
 * One row in the breakdown: either a single code line with its OE cost and how
 * many times it runs, or a "for" header whose sub-parts (init, cond, inc) live
 * in `subLines` and get collapsed under a chevron.
 */
export interface BreakdownRow {
  /**
   * Verbatim code as it appears on this line. Used as the label of the
   * breakdown row AND, when `code` is provided, to auto-locate the row's
   * line inside the source so hovering / clicking a row highlights that
   * line in the real CodeEditor.
   */
  line: string;
  /** OE count of this line (per execution). Ignored on rows that only hold subLines. */
  oe?: number;
  /**
   * Times this line executes, as a formula in the variable `variable`.
   * Use `n` (or the widget's `variable` prop) freely — the formula is both
   * evaluated numerically and shown symbolically. Ignored on rows that only
   * hold subLines.
   */
  times?: string;
  /**
   * Sub-parts of a `for` (typically init / cond / inc), collapsed by default,
   * expanded on click. Each carries its own `oe` and `times`.
   */
  subLines?: BreakdownRow[];
  /**
   * 1-based line number in `code` this row corresponds to. Optional: if
   * omitted, the widget tries to locate `line` inside `code` (exact-trim
   * match first, then substring). Provide it explicitly when the auto-match
   * would be ambiguous.
   */
  codeLine?: number;
}

/**
 * A single case's breakdown: the rows, the final formula in the variable, and
 * a callable evaluator so the widget can print `T(n) = ... = 4n + 4` and then
 * `Para N = 100 → T = 404`.
 */
export interface ComplexityCase {
  /** Rows in reading order. */
  breakdown: BreakdownRow[];
  /** Final closed form as LaTeX-compatible source, e.g. `4n + 4`. */
  formula: string;
  /**
   * Numeric evaluator for `formula`, so the widget shows T evaluated at the
   * slider's current value. `(n) => 4*n + 4` for the example. Required and
   * declarative: parsing `formula` symbolically is out of scope.
   */
  evaluate: (n: number) => number;
}

export interface ComplexityCounterProps {
  /** Human-readable identifier of the algorithm — shown in the widget header. */
  algorithm?: string;
  /**
   * The full source code shown on the left of the widget, verbatim. When
   * provided, it is rendered through the real `<CodeStepper>` (same syntax
   * highlighting as any other Java snippet on the site) with per-line
   * highlighting driven by hovering the annotations on the right.
   * When omitted, the widget falls back to a one-column layout with just
   * the annotations table.
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
  /**
   * Language for CodeStepper's grammar. Defaults to 'java' (matches the
   * default of CodeStepper itself; keep in sync with the class's runtime).
   */
  language?: string;
}

const DEFAULT_SLIDER = { min: 1, max: 100, default: 10, step: 1 };

/**
 * A widget that makes the process of counting operations visible (ADR-0045).
 *
 * The layout is code-on-the-left, annotations-on-the-right (falls back to a
 * single annotations column when no `code` is provided). The code is rendered
 * through `<CodeStepper>` — the same read-only CodeMirror path every other
 * Java snippet on the site uses, so the listing here reads exactly as any
 * fence or editor elsewhere in the course. Annotations sit in a right rail
 * that carries OE per execution and how many times each line runs; hovering
 * or clicking an annotation highlights the corresponding line in the editor.
 *
 * Mode `cases` renders three tabs (mejor / peor / promedio); mode `space`
 * swaps the OE column for memory cells and prints M(n) instead of T(n).
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
        <code>{'{ breakdown, formula, evaluate }'}</code> con el desglose por línea, la fórmula
        final y su evaluador numérico.
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

  const unitLabel = mode === 'space' ? 'celdas' : 'OE';
  const totalLabel = mode === 'space' ? 'M' : 'T';
  const evaluated = active.evaluate(n);

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

      <div
        className={
          code === undefined || code.trim() === ''
            ? 'border-t border-rule'
            : 'grid grid-cols-1 border-t border-rule md:grid-cols-[1fr_16rem]'
        }
      >
        {code !== undefined && code.trim() !== '' && (
          <div className="min-w-0 overflow-hidden border-b border-rule md:border-b-0 md:border-r">
            <CodeStepper
              code={code}
              language={language}
              highlightLines={activeLine === null ? [] : [activeLine]}
            />
          </div>
        )}
        <ul className="flex flex-col divide-y divide-rule/50 bg-sunk/30 font-mono text-xs text-ink-soft">
          {active.breakdown.map((row, index) => (
            <BreakdownRowView
              key={index}
              row={row}
              variable={variable}
              n={n}
              code={code}
              isExpanded={expanded.has(index)}
              onToggle={() => {
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                });
              }}
              onHover={(line) => setActiveLine(line)}
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

interface BreakdownRowViewProps {
  row: BreakdownRow;
  variable: string;
  n: number;
  code: string | undefined;
  isExpanded: boolean;
  onToggle: () => void;
  onHover: (line: number | null) => void;
  unitLabel: string;
}

function BreakdownRowView({
  row,
  variable,
  n,
  code,
  isExpanded,
  onToggle,
  onHover,
  unitLabel,
}: BreakdownRowViewProps) {
  const hasSubLines = row.subLines !== undefined && row.subLines.length > 0;
  const codeLine = useMemo(() => resolveLine(row, code), [row, code]);
  const hoverProps = codeLine
    ? {
        onMouseEnter: () => onHover(codeLine),
        onMouseLeave: () => onHover(null),
        onFocus: () => onHover(codeLine),
        onBlur: () => onHover(null),
      }
    : {};

  if (hasSubLines) {
    const totalOe = row.subLines!.reduce((sum, sub) => {
      const times = sub.times ? evaluateFormula(sub.times, variable, n) : 0;
      return sum + (sub.oe ?? 0) * times;
    }, 0);
    return (
      <>
        <li className="flex items-start gap-2 px-3 py-1.5 hover:bg-accent-soft/20" {...hoverProps}>
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
            <div className="truncate text-ink">
              <code>{row.line}</code>
            </div>
            <div className="text-3xs text-ink-faint">
              control ({row.subLines!.length} partes) · {totalOe.toLocaleString('es')} {unitLabel} total
            </div>
          </div>
        </li>
        {isExpanded &&
          row.subLines!.map((sub, i) => {
            const subLine = resolveLine(sub, code);
            const subHover = subLine
              ? {
                  onMouseEnter: () => onHover(subLine),
                  onMouseLeave: () => onHover(null),
                }
              : {};
            const times = sub.times ? evaluateFormula(sub.times, variable, n) : 0;
            return (
              <li
                key={`sub-${i}`}
                className="flex items-start gap-2 bg-sunk/40 px-3 py-1 pl-8 hover:bg-accent-soft/20"
                {...subHover}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <code>{sub.line}</code>
                  </div>
                  <div className="text-3xs text-ink-faint">
                    {sub.oe ?? 0} {unitLabel} · {sub.times ?? ''}
                    {sub.times !== undefined && (
                      <span> = {times.toLocaleString('es')}</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
      </>
    );
  }

  const times = row.times ? evaluateFormula(row.times, variable, n) : 0;
  return (
    <li className="flex items-start gap-2 px-3 py-1.5 hover:bg-accent-soft/20" {...hoverProps}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-ink">
          <code>{row.line}</code>
        </div>
        <div className="text-3xs text-ink-faint">
          {row.oe ?? 0} {unitLabel}
          {row.times !== undefined && (
            <>
              {' · '}
              {row.times}
              {' = '}
              {times.toLocaleString('es')}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Maps a breakdown row to a 1-based line number in `code`. Prefers an
 * explicit `codeLine`; else searches for the row's `line` text inside `code`
 * (exact trimmed match first, then substring). Returns null when nothing
 * matches — the row just gets no hover-highlight.
 */
function resolveLine(row: BreakdownRow, code: string | undefined): number | null {
  if (row.codeLine !== undefined) return row.codeLine;
  if (code === undefined || code.trim() === '') return null;
  const lines = code.split('\n');
  const needle = row.line.trim();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === needle) return i + 1;
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(needle)) return i + 1;
  }
  return null;
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
    // Restrict to arithmetic + the variable, so a stray identifier does not
    // accidentally reach a real name — an author typo that introduced `nn`
    // would throw here instead of resolving to `undefined` in strict mode.
    const trimmed = formula.trim();
    if (trimmed === '') return 0;
    // Substitution respects word boundaries so `variable = 'n'` does not
    // rewrite `nueva` or `logn`.
    const substituted = trimmed.replace(new RegExp(`\\b${variable}\\b`, 'g'), `(${n})`);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`return (${substituted});`);
    const value = fn() as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
