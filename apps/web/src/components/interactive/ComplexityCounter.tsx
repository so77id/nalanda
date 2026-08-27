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
  /**
   * Free-form pedagogical note about this line. Used ONLY by `mode="recursion"`
   * (ADR-0048) to point out "esta llamada aporta T(n-1)"-style annotations
   * that are not algebraic contributions but recurrence-building observations.
   * The other modes ignore this field.
   */
  note?: string;
}

/**
 * One step in the recurrence unroll: the current form (as author-written
 * text — the widget does not parse or manipulate) plus an optional short
 * parenthetical note explaining what changed at this step. Used ONLY by
 * `mode="recursion"` (ADR-0048).
 */
export interface RecurrenceStep {
  /** Author-written text (`"T(n) = T(n-1) + T(n-2) + c"`). Rendered verbatim. */
  form: string;
  /** Short Spanish parenthetical, e.g. "sustituimos T(n-1)". */
  note?: string;
}

/**
 * A single case's annotations plus the closed-form T(n).
 */
export interface ComplexityCase {
  /** Line-number → annotation. The key is the 1-based line in `code`. */
  annotations: Record<number, LineAnnotation>;
  /**
   * Final closed form as human-readable string (e.g. `"4n + 4"`). Required for
   * `'base' | 'cases' | 'space'`; ignored in `'abstract' | 'recursion'` (in
   * recursion mode the analogue is `closedForm`).
   */
  formula?: string;
  /**
   * Numeric evaluator for `formula`, so the widget prints T evaluated at the
   * slider's current value. Declared alongside `formula` — the widget never
   * derives one from the other. Required for `'base' | 'cases' | 'space'`;
   * ignored in `'abstract' | 'recursion'`.
   */
  evaluate?: (n: number) => number;
  /**
   * Lines that don't execute in this scenario. Each entry can carry an
   * optional pedagogical `note` explaining why. In `'abstract'` mode the
   * lines are painted dimmed in the code editor, and the notes render as
   * a dedicated section at the bottom of the rail. Ignored in the other
   * modes.
   */
  skipped?: Array<{ line: number; note?: string }>;
  // ------------------------------------------------------------------
  // Recursion-mode fields (ADR-0048) — required for `mode="recursion"`,
  // ignored elsewhere. The widget renders these verbatim; it does not
  // solve, parse or manipulate the recurrence.
  // ------------------------------------------------------------------
  /** The recurrence as author-written text (`"T(n) = T(n-1) + T(n-2) + c"`). */
  recurrence?: string;
  /** Base cases as `{ "T(0)": "c", "T(1)": "c" }`. Empty object is allowed. */
  base?: Record<string, string>;
  /** Ordered unroll steps (see `RecurrenceStep`). May be empty. */
  unroll?: RecurrenceStep[];
  /** The closed form (`"T(n) = Θ(φⁿ)"`) shown in its own emphasised panel. */
  closedForm?: string;
}

export interface ComplexityCounterProps {
  /** Human-readable identifier of the algorithm — shown in the widget header. */
  algorithm?: string;
  /**
   * The full source code shown on the left of the widget, verbatim. Required:
   * annotations are anchored by line number in this code.
   */
  code?: string;
  /**
   * Mode:
   * - `'base'`: one case, with slider, formula and evaluation.
   * - `'cases'`: three tabs (best/worst/average), each with its own slider/formula.
   * - `'space'`: same layout as `'base'` but the unit is memory cells (M) instead of OE.
   * - `'abstract'`: code + per-line annotations, WITHOUT slider, formula, or numeric
   *   substitution — the `times` field is displayed as descriptive text
   *   (e.g. `"por iteración"`). Used to introduce a code before any specific
   *   case has been derived; the same widget then re-appears in `'base'` mode
   *   for each concrete case.
   * - `'recursion'` (ADR-0048): code + per-line free-form `note` annotations +
   *   three static panels (Recurrencia, Desarrollo, Forma cerrada). No slider,
   *   no OE substitution, no algebraic parsing. Used to analyse the cost of
   *   a recursive algorithm.
   */
  mode?: 'base' | 'cases' | 'space' | 'abstract' | 'recursion';
  /** For mode = 'base' | 'space' | 'abstract': the single case to show. In `'abstract'`, only `annotations` is required. */
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
  /**
   * When `false`, shows only the read-only editor — hides the header,
   * tabs, slider, rail and construction panel. Used by
   * `<ComplexityExercise>` to render a code-only view before the student
   * reveals the analysis (the SAME box then expands when they click
   * "Ver desarrollo", instead of a second editor mounting below).
   * Default `true` keeps the standalone widget's behaviour.
   */
  showAnalysis?: boolean;
  /**
   * When `false`, suppresses the widget's own header (the "operaciones ·
   * <algorithm>" tag). Used by wrappers like `<ComplexityExercise>` that
   * already draw their own header — avoids the double-header a naive
   * embedding would produce. Default `true` keeps the standalone
   * widget's behaviour.
   */
  showHeader?: boolean;
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
  showAnalysis = true,
  showHeader = true,
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

  if (code === undefined || code.trim() === '') {
    return (
      <AuthoringError component="ComplexityCounter">
        falta la prop <code>code</code>: las anotaciones se anclan por número de línea al código
        fuente.
      </AuthoringError>
    );
  }
  // `data`/`cases` are only required for the analysis. When `showAnalysis`
  // is off, the widget degrades to a code-only view — used by
  // `<ComplexityExercise>` before the student reveals the analysis.
  const isAbstract = mode === 'abstract';
  const isRecursion = mode === 'recursion';
  if (showAnalysis) {
    if (mode === 'cases' && (cases === undefined || Object.keys(cases).length === 0)) {
      return (
        <AuthoringError component="ComplexityCounter">
          modo <code>cases</code> requiere la prop <code>cases</code> con al menos un caso (
          <code>best</code>, <code>worst</code> o <code>average</code>).
        </AuthoringError>
      );
    }
    if (mode !== 'cases' && data === undefined) {
      const shape = isRecursion
        ? '{ annotations, recurrence, base, unroll, closedForm }'
        : isAbstract
          ? '{ annotations }'
          : '{ annotations, formula, evaluate }';
      const tail = isRecursion
        ? ', la recurrencia, sus casos base, los pasos del desarrollo y la forma cerrada'
        : isAbstract
          ? ''
          : ', la fórmula final y su evaluador numérico';
      return (
        <AuthoringError component="ComplexityCounter">
          falta la prop <code>data</code>: un objeto <code>{shape}</code> con las anotaciones por
          línea{tail}.
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
    if (isRecursion) {
      if (
        active.recurrence === undefined ||
        active.unroll === undefined ||
        active.closedForm === undefined
      ) {
        return (
          <AuthoringError component="ComplexityCounter">
            falta la prop <code>recurrence</code>, <code>unroll</code> o <code>closedForm</code> en
            el caso. El modo <code>recursion</code> necesita los tres para renderizar la
            recurrencia, el desarrollo y la forma cerrada.
          </AuthoringError>
        );
      }
    } else if (!isAbstract && (active.formula === undefined || active.evaluate === undefined)) {
      return (
        <AuthoringError component="ComplexityCounter">
          modo <code>{mode}</code> requiere <code>formula</code> y <code>evaluate</code> en el caso.
          Si no querés derivar la fórmula todavía, usá <code>mode=&quot;abstract&quot;</code>.
        </AuthoringError>
      );
    }
  }

  // Code-only view: same frame + editor as the full widget, but the header,
  // slider, rail and panel are all suppressed. The frame stays because
  // <ComplexityExercise> wraps this in its own border; the editor inside
  // matches the analysis view visually so revealing feels like the same box
  // opening up, not a second widget mounting below.
  if (!showAnalysis) {
    return (
      <div className="not-prose overflow-hidden rounded-lg border border-rule bg-surface text-ink">
        <CodeStepper
          code={code}
          language={language}
          highlightLines={activeLine === null ? [] : [activeLine]}
          onLineHover={setActiveLine}
        />
      </div>
    );
  }

  if (isRecursion) {
    const codeLines = code.split('\n');
    const recursionEntries = Object.entries(active!.annotations)
      .map(([k, v]) => [Number(k), v] as const)
      .sort((a, b) => a[0] - b[0]);
    const baseEntries = Object.entries(active!.base ?? {});
    return (
      <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
        {showHeader && (
          <header className="flex flex-wrap items-center gap-2 bg-sunk px-3 py-1.5">
            <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
              recurrencia
            </span>
            {algorithm !== undefined && (
              <span className="font-mono text-sm text-ink">{algorithm}</span>
            )}
          </header>
        )}

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
            aria-label="Desglose de recurrencia por línea"
            className="flex flex-col divide-y divide-rule/50 bg-sunk/30 font-mono text-xs text-ink-soft"
          >
            {recursionEntries.map(([lineNum, ann]) => {
              const isActive = activeLine === lineNum;
              const activeClass = isActive ? 'bg-accent-soft/40' : 'hover:bg-accent-soft/20';
              return (
                <li
                  key={lineNum}
                  className={`flex items-start gap-2 px-3 py-1.5 ${activeClass}`}
                  onMouseEnter={() => setActiveLine(lineNum)}
                  onMouseLeave={() => setActiveLine(null)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-ink">
                      <span className="w-6 shrink-0 text-right text-3xs text-ink-faint">
                        {lineNum}
                      </span>
                      <code className="truncate">{(codeLines[lineNum - 1] ?? '').trim()}</code>
                    </div>
                    {ann.note !== undefined && (
                      <div className="pl-8 text-3xs text-ink-faint">{ann.note}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <Panel label="Recurrencia">
          <div className={`${OUTPUT} bg-sunk text-ink`}>
            <div>{active!.recurrence}</div>
            {baseEntries.length > 0 && (
              <div className="mt-1 text-ink-soft">
                {baseEntries.map(([k, v]) => (
                  <div key={k}>
                    {k} = {v}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel label="Desarrollo">
          <div className={`${OUTPUT} bg-sunk text-ink`}>
            {active!.unroll!.map((step, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3">
                <span>{step.form}</span>
                {step.note !== undefined && (
                  <span className="text-3xs text-ink-faint">({step.note})</span>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel label="Forma cerrada">
          <div className={`${OUTPUT} bg-accent-soft/40 text-ink`}>
            <strong className="font-mono">{active!.closedForm}</strong>
          </div>
        </Panel>
      </div>
    );
  }

  const unitLabel = mode === 'space' ? 'celdas' : 'OE';
  const totalLabel = mode === 'space' ? 'M' : 'T';
  const evaluated = isAbstract ? 0 : active!.evaluate!(n);
  const codeLines = code.split('\n');
  // Rail rows ordered by line number, only lines the author annotated.
  const annotationEntries = Object.entries(active!.annotations)
    .map(([k, v]) => [Number(k), v] as const)
    .sort((a, b) => a[0] - b[0]);

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      {showHeader && (
        <header className="flex flex-wrap items-center gap-2 bg-sunk px-3 py-1.5">
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
            {mode === 'space' ? 'espacio' : 'operaciones'}
          </span>
          {algorithm !== undefined && (
            <span className="font-mono text-sm text-ink">{algorithm}</span>
          )}
        </header>
      )}

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

      {!isAbstract && (
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
      )}

      <div className="grid grid-cols-1 border-t border-rule md:grid-cols-[1fr_18rem]">
        <div className="min-w-0 overflow-hidden border-b border-rule md:border-b-0 md:border-r">
          <CodeStepper
            code={code}
            language={language}
            highlightLines={activeLine === null ? [] : [activeLine]}
            dimmedLines={(active?.skipped ?? []).map((s) => s.line)}
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
              isAbstract={isAbstract}
            />
          ))}
          {isAbstract &&
            (active?.skipped ?? []).map(({ line, note }) => (
              <li
                key={`skip-${line}`}
                className="flex items-start gap-2 px-3 py-1.5 opacity-70"
                onMouseEnter={() => setActiveLine(line)}
                onMouseLeave={() => setActiveLine(null)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-ink-faint">
                    <span className="w-6 shrink-0 text-right text-3xs">{line}</span>
                    <code className="truncate line-through">
                      {(codeLines[line - 1] ?? '').trim()}
                    </code>
                  </div>
                  <div className="pl-8 text-3xs italic text-ink-faint">
                    no se ejecuta{note !== undefined && ` — ${note}`}
                  </div>
                </div>
              </li>
            ))}
        </ul>
      </div>

      {!isAbstract && (
        <Panel label={`Construcción de ${totalLabel}(${variable})`}>
          <pre className={`${OUTPUT} bg-sunk text-ink`}>
            {renderConstruction({
              entries: annotationEntries,
              codeLines,
              variable,
              n,
              formula: active!.formula!,
              evaluated,
              totalLabel,
              unitLabel,
            })}
          </pre>
        </Panel>
      )}
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
  /**
   * Abstract mode: show `times` verbatim as descriptive text (no algebra
   * parsing, no numeric substitution). The rail becomes a legend of costs
   * per line without deriving any total.
   */
  isAbstract?: boolean;
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
  isAbstract = false,
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
    // headline. The header shows BOTH the literal summed expression
    // (`1 + (n+1) + n`) and its numeric evaluation at the current slider
    // (`= 22`). Sub-ops appear only when expanded. In abstract mode we drop
    // the numeric aggregate — `times` is descriptive text, not an algebraic
    // expression, so nothing to evaluate — and just list the sub-parts.
    const literalSum = isAbstract
      ? ann.sub!.map((s) => s.label).join(' + ')
      : ann.sub!.map((s) => termLiteral(s.oe, s.times)).join(' + ');
    const totalOe = isAbstract
      ? null
      : ann.sub!.reduce((sum, s) => sum + s.oe * evaluateFormula(s.times, variable, n), 0);
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
              <span className="w-6 shrink-0 text-right text-3xs text-ink-faint">{lineNum}</span>
              <code className="truncate">{lineText.trim()}</code>
            </div>
            <div className="pl-8 text-3xs text-ink-faint">
              control · {literalSum}
              {totalOe !== null && (
                <>
                  {' '}
                  <span className="text-ink-faint">
                    [{variable}={n.toLocaleString('es')}]
                  </span>{' '}
                  = <span className="text-ink">{totalOe.toLocaleString('es')}</span> {unitLabel}
                </>
              )}
            </div>
          </div>
        </li>
        {isExpanded &&
          ann.sub!.map((sub, i) => {
            if (isAbstract) {
              return (
                <li key={`sub-${i}`} className="flex items-start gap-2 bg-sunk/50 px-3 py-1 pl-11">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-ink-soft">
                      <span className="rounded bg-accent-soft/50 px-1 text-3xs uppercase tracking-wide text-accent">
                        {sub.label}
                      </span>
                      <span className="text-3xs">
                        {sub.oe} {unitLabel} · {sub.times}
                      </span>
                    </div>
                  </div>
                </li>
              );
            }
            const times = evaluateFormula(sub.times, variable, n);
            const contrib = sub.oe * times;
            const isConst = isConstantTimes(sub.times);
            return (
              <li key={`sub-${i}`} className="flex items-start gap-2 bg-sunk/50 px-3 py-1 pl-11">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-ink-soft">
                    <span className="rounded bg-accent-soft/50 px-1 text-3xs uppercase tracking-wide text-accent">
                      {sub.label}
                    </span>
                    <span className="text-3xs">
                      {sub.oe} {unitLabel} · {sub.times}
                      {!isConst && (
                        <span className="text-ink-faint">
                          {' '}
                          [{variable}={n.toLocaleString('es')}]
                        </span>
                      )}
                      {' = '}
                      <span className="text-ink">{contrib.toLocaleString('es')}</span>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
      </>
    );
  }

  // Plain row: OE × times → aporte total. When `times` is not the constant
  // `1` we also show the substitution `[n=N]` so the algebra and the number
  // sit side by side. In abstract mode we display `times` verbatim as
  // descriptive text with no substitution and no total.
  const oe = ann.oe ?? 0;
  const timesStr = ann.times ?? '1';
  if (isAbstract) {
    return (
      <li className={`flex items-start gap-2 px-3 py-1.5 ${activeClass}`} {...hoverProps}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-ink">
            <span className="w-6 shrink-0 text-right text-3xs text-ink-faint">{lineNum}</span>
            <code className="truncate">{lineText.trim()}</code>
          </div>
          <div className="pl-8 text-3xs text-ink-faint">
            {oe} {unitLabel} · {timesStr}
          </div>
        </div>
      </li>
    );
  }
  const times = evaluateFormula(timesStr, variable, n);
  const contrib = oe * times;
  const isConst = isConstantTimes(timesStr);
  return (
    <li className={`flex items-start gap-2 px-3 py-1.5 ${activeClass}`} {...hoverProps}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-ink">
          <span className="w-6 shrink-0 text-right text-3xs text-ink-faint">{lineNum}</span>
          <code className="truncate">{lineText.trim()}</code>
        </div>
        <div className="pl-8 text-3xs text-ink-faint">
          {oe} {unitLabel} · {timesStr} {isConst ? (timesStr === '1' ? 'vez' : 'veces') : 'veces'}
          {!isConst && (
            <span className="text-ink-faint">
              {' '}
              [{variable}={n.toLocaleString('es')}]
            </span>
          )}
          {' → aporta '}
          <span className="text-ink">{contrib.toLocaleString('es')}</span> {unitLabel}
        </div>
      </div>
    </li>
  );
}

/**
 * Formats one OE × times term for the construction expression.
 * `termLiteral(1, '1') → "1"`, `termLiteral(2, 'n') → "2·n"`,
 * `termLiteral(1, 'n+1') → "(n+1)"`.
 */
function termLiteral(oe: number, times: string): string {
  const t = times.trim();
  if (oe === 1 && t === '1') return '1';
  if (oe === 1) return needsParens(t) ? `(${t})` : t;
  if (t === '1') return String(oe);
  return needsParens(t) ? `${oe}·(${t})` : `${oe}·${t}`;
}

function needsParens(expr: string): boolean {
  // Wrap in parens if it contains any operator so the printed sum reads
  // unambiguously (`1·(n+1)`, `2·(n*(n+1)/2)`).
  return /[+\-*/]/.test(expr);
}

function isConstantTimes(times: string): boolean {
  return /^\s*\d+(\.\d+)?\s*$/.test(times);
}

/**
 * Renders the "Construcción de T(n)" text panel. One row per annotated line,
 * each showing the line's contribution expression and its evaluated value;
 * a running "T(n) = ..." summary at the bottom with the closed-form formula
 * and the total at the current slider.
 */
function renderConstruction({
  entries,
  codeLines,
  variable,
  n,
  formula,
  evaluated,
  totalLabel,
  unitLabel,
}: {
  entries: readonly (readonly [number, LineAnnotation])[];
  codeLines: string[];
  variable: string;
  n: number;
  formula: string;
  evaluated: number;
  totalLabel: string;
  unitLabel: string;
}): string {
  const rows: { label: string; term: string; value: number }[] = [];
  for (const [lineNum, ann] of entries) {
    const codeText = (codeLines[lineNum - 1] ?? '').trim();
    const label = `L${lineNum} ${truncate(codeText, 34)}`;
    if (ann.sub !== undefined && ann.sub.length > 0) {
      const term = ann.sub.map((s) => termLiteral(s.oe, s.times)).join(' + ');
      const value = ann.sub.reduce(
        (sum, s) => sum + s.oe * evaluateFormula(s.times, variable, n),
        0,
      );
      rows.push({ label, term, value });
    } else {
      const oe = ann.oe ?? 0;
      const timesStr = ann.times ?? '1';
      rows.push({
        label,
        term: termLiteral(oe, timesStr),
        value: oe * evaluateFormula(timesStr, variable, n),
      });
    }
  }
  // Column widths for aligned monospace layout.
  const labelW = Math.max(...rows.map((r) => r.label.length), 0);
  const termW = Math.max(...rows.map((r) => r.term.length), 0);
  const perLine = rows
    .map(
      (r) =>
        `  ${r.label.padEnd(labelW)}   ${r.term.padEnd(termW)}   =  ${r.value.toLocaleString('es')}`,
    )
    .join('\n');
  const sumExpr = rows.map((r) => (r.term.includes('+') ? `(${r.term})` : r.term)).join(' + ');
  return (
    `Aporte de cada línea (${variable} = ${n.toLocaleString('es')}):\n` +
    `${perLine}\n\n` +
    `${totalLabel}(${variable}) = ${sumExpr}\n` +
    `       = ${formula}    (forma cerrada)\n\n` +
    `Para ${variable} = ${n.toLocaleString('es')}  →  ${totalLabel}(${n.toLocaleString('es')}) = ${evaluated.toLocaleString('es')} ${unitLabel}`
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
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
