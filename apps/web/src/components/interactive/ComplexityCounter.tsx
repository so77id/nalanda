import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { OUTPUT, Panel } from './Panel';

/**
 * One row in the breakdown: either a single code line with its OE cost and how
 * many times it runs, or a "for" header whose sub-parts (init, cond, inc) live
 * in `subLines` and get collapsed under a chevron.
 */
export interface BreakdownRow {
  /** Verbatim code as it appears on this line. */
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
   * The code the widget breaks down, verbatim. Used as a reference display
   * beneath the breakdown table (the table itself carries the line-by-line
   * annotations, so the code block is a re-read of the whole algorithm).
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
}

const DEFAULT_SLIDER = { min: 1, max: 100, default: 10, step: 1 };

/**
 * A widget that makes the process of counting operations visible (ADR-0045).
 *
 * The author writes an algorithm plus a declarative breakdown — one row per
 * line, each with an OE count and a formula for how many times the line
 * runs — and the widget renders it as a three-column table: code, OE per
 * execution, executions. Under it: `T(n) = <sum> = <closed form>` and then
 * `Para N = <slider> → T = <evaluated>`. The reader moves the slider and
 * the "executions" column plus the evaluated T update; the closed form
 * does not, because it is a property of the algorithm.
 *
 * Mode `cases` renders three tabs (mejor / peor / promedio), each with its
 * own breakdown and formula — used in Act 5 to show that FindInArray has
 * three qualitatively different behaviours over the same code. Mode
 * `space` swaps the "OE" column for "celdas de memoria" but is otherwise
 * the same shape.
 *
 * Deliberately declarative — the widget does not parse Java or attempt to
 * count operations automatically. Miguel rejected the "widget parses the
 * code" alternative at refinement: a parser would be silently wrong on
 * edge cases, and hiding a counting model inside JS would defeat the
 * pedagogical point (the reader must SEE the counting). The catalog
 * example demonstrates the shape once; every use in the class inherits it.
 */
export function ComplexityCounter({
  algorithm,
  code,
  mode = 'base',
  data,
  cases,
  slider,
  variable = 'n',
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
                onClick={() => setCaseKey(k)}
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

      <div className="overflow-x-auto border-t border-rule">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-rule bg-sunk text-3xs uppercase tracking-wide text-ink-faint">
              <th className="px-3 py-1 text-left font-mono font-normal">código</th>
              <th className="px-2 py-1 text-right font-mono font-normal">{unitLabel}/vez</th>
              <th className="px-3 py-1 text-right font-mono font-normal">ejecuciones</th>
            </tr>
          </thead>
          <tbody className="font-mono text-ink-soft">
            {active.breakdown.map((row, index) => (
              <BreakdownRowView
                key={index}
                row={row}
                variable={variable}
                n={n}
                isExpanded={expanded.has(index)}
                onToggle={() => {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Panel label={`${totalLabel}(${variable})`}>
        <pre className={`${OUTPUT} bg-sunk text-ink`}>
          {totalLabel}({variable}) = {active.formula}
          {'\n'}
          Para {variable.toUpperCase()} = {n.toLocaleString('es')} → {totalLabel} ={' '}
          {evaluated.toLocaleString('es')} {unitLabel}
        </pre>
      </Panel>

      {code !== undefined && code.trim() !== '' && (
        <Panel label="código completo">
          <pre className={`${OUTPUT} bg-sunk text-ink`}>{code}</pre>
        </Panel>
      )}
    </div>
  );
}

interface BreakdownRowViewProps {
  row: BreakdownRow;
  variable: string;
  n: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function BreakdownRowView({ row, variable, n, isExpanded, onToggle }: BreakdownRowViewProps) {
  const hasSubLines = row.subLines !== undefined && row.subLines.length > 0;
  if (hasSubLines) {
    const totalOe = row.subLines!.reduce((sum, sub) => {
      const times = sub.times ? evaluateFormula(sub.times, variable, n) : 0;
      return sum + (sub.oe ?? 0) * times;
    }, 0);
    return (
      <>
        <tr className="border-b border-rule/50">
          <td className="px-3 py-1 text-ink">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Contraer sub-conteos' : 'Expandir sub-conteos'}
              className="mr-1 inline-flex items-center align-middle text-ink-faint hover:text-ink"
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <code>{row.line}</code>
          </td>
          <td className="px-2 py-1 text-right text-ink-faint">
            {totalOe.toLocaleString('es')} (total)
          </td>
          <td className="px-3 py-1 text-right text-ink-faint">
            control ({row.subLines!.length} partes)
          </td>
        </tr>
        {isExpanded &&
          row.subLines!.map((sub, i) => (
            <tr key={`sub-${i}`} className="border-b border-rule/30 bg-sunk/30">
              <td className="px-3 py-1 pl-8 text-ink-soft">
                <code>{sub.line}</code>
              </td>
              <td className="px-2 py-1 text-right">{sub.oe ?? 0}</td>
              <td className="px-3 py-1 text-right">
                {sub.times ?? ''}
                {sub.times !== undefined && (
                  <span className="text-ink-faint"> = {evaluateFormula(sub.times, variable, n)}</span>
                )}
              </td>
            </tr>
          ))}
      </>
    );
  }
  const times = row.times ? evaluateFormula(row.times, variable, n) : 0;
  return (
    <tr className="border-b border-rule/50 last:border-0">
      <td className="px-3 py-1 text-ink">
        <code>{row.line}</code>
      </td>
      <td className="px-2 py-1 text-right">{row.oe ?? 0}</td>
      <td className="px-3 py-1 text-right">
        {row.times === undefined ? (
          '—'
        ) : (
          <>
            {row.times}
            <span className="text-ink-faint"> = {times}</span>
          </>
        )}
      </td>
    </tr>
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
