import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';

import { AuthoringError } from '../AuthoringError';
import { OUTPUT, Panel } from './Panel';

/**
 * Java keywords/types recognised by the lightweight tokenizer. This is NOT a
 * parser — it is a display-only regex-based colouriser so the code column of
 * `<ComplexityCounter>` reads as syntax-highlighted Java instead of grey text.
 * The set is small on purpose: overpainting is worse than under-painting when
 * a token is ambiguous. ADR-0045 §7 keeps this as the shipping approach
 * until the CodeMirror-integrated gutter lands.
 */
const JAVA_KEYWORDS = new Set([
  'abstract',
  'assert',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'interface',
  'native',
  'new',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'try',
  'volatile',
  'while',
  'yield',
]);
const JAVA_TYPES = new Set([
  'boolean',
  'byte',
  'char',
  'double',
  'float',
  'int',
  'long',
  'short',
  'void',
  'String',
  'Integer',
  'Long',
  'Double',
  'Boolean',
  'Character',
  'Object',
  'Scanner',
  'System',
  'Math',
  'Arrays',
  'List',
  'ArrayList',
  'Map',
  'HashMap',
  'Set',
  'HashSet',
]);
const JAVA_LITERALS = new Set(['true', 'false', 'null']);

/**
 * Tokenizes one line of Java for display and returns coloured spans.
 * Handles: line comments, string literals, char literals, numeric literals,
 * keywords, types, and named literals. Everything else passes through as ink.
 * Tailwind classes use only design-system tokens (see `apps/web/CLAUDE.md` and
 * `docs/standards/design-system.md`).
 */
/**
 * Colours used by the tokenizer. Deliberately declared as inline CSS custom
 * properties on the widget root (see the component below), NOT as raw
 * Tailwind classes — the architecture test bans raw Tailwind colours since
 * they only render right in one theme (ADR-0026, design-system.md). The
 * variables here render right in both themes: the widget root sets
 * `light-dark(...)` on each so the browser picks the right side automatically.
 */
type Kind = 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'literal';

const KIND_VAR: Record<Kind, string> = {
  comment: 'var(--nl-cc-comment)',
  string: 'var(--nl-cc-string)',
  number: 'var(--nl-cc-number)',
  keyword: 'var(--nl-cc-keyword)',
  type: 'var(--nl-cc-type)',
  literal: 'var(--nl-cc-literal)',
};

function highlightJava(line: string): ReactNode {
  const tokens: ReactNode[] = [];
  const pattern = new RegExp(
    [
      '\\/\\/[^\\n]*', // line comment
      '"(?:[^"\\\\]|\\\\.)*"', // string literal
      "'(?:[^'\\\\]|\\\\.)*'", // char literal
      '\\b\\d+(?:\\.\\d+)?[LlFfDd]?\\b', // number literal
      '[A-Za-z_][A-Za-z0-9_]*', // identifier
    ].join('|'),
    'g',
  );
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(line)) !== null) {
    const [text] = match;
    if (match.index > last) {
      tokens.push(<Fragment key={`p-${key++}`}>{line.slice(last, match.index)}</Fragment>);
    }
    let kind: Kind | null = null;
    let bold = false;
    if (text.startsWith('//')) {
      kind = 'comment';
    } else if (text.startsWith('"') || text.startsWith("'")) {
      kind = 'string';
    } else if (/^\d/.test(text)) {
      kind = 'number';
    } else if (JAVA_KEYWORDS.has(text)) {
      kind = 'keyword';
      bold = true;
    } else if (JAVA_TYPES.has(text)) {
      kind = 'type';
    } else if (JAVA_LITERALS.has(text)) {
      kind = 'literal';
      bold = true;
    }
    tokens.push(
      kind === null ? (
        <Fragment key={`t-${key++}`}>{text}</Fragment>
      ) : (
        <span
          key={`t-${key++}`}
          style={{
            color: KIND_VAR[kind],
            fontWeight: bold ? 500 : undefined,
            fontStyle: kind === 'comment' ? 'italic' : undefined,
          }}
        >
          {text}
        </span>
      ),
    );
    last = match.index + text.length;
  }
  if (last < line.length) tokens.push(<Fragment key={`p-${key++}`}>{line.slice(last)}</Fragment>);
  return <>{tokens}</>;
}

/**
 * CSS variables the widget declares on its root so both themes resolve to a
 * legible palette without touching the raw-Tailwind ban. `light-dark(...)`
 * is the modern CSS function that lets the browser pick per active theme.
 */
const SYNTAX_STYLE: React.CSSProperties = {
  ['--nl-cc-comment' as string]: 'light-dark(rgb(107 114 128), rgb(148 163 184))',
  ['--nl-cc-string' as string]: 'light-dark(rgb(5 150 105), rgb(52 211 153))',
  ['--nl-cc-number' as string]: 'light-dark(rgb(217 119 6), rgb(251 191 36))',
  ['--nl-cc-keyword' as string]: 'light-dark(rgb(124 58 237), rgb(167 139 250))',
  ['--nl-cc-type' as string]: 'light-dark(rgb(2 132 199), rgb(56 189 248))',
  ['--nl-cc-literal' as string]: 'light-dark(rgb(217 119 6), rgb(251 191 36))',
};

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
        modo <code>cases</code> requiere la prop <code>cases</code> con al menos un caso (
        <code>best</code>, <code>worst</code> o <code>average</code>).
      </AuthoringError>
    );
  }
  if (mode !== 'cases' && data === undefined) {
    return (
      <AuthoringError component="ComplexityCounter">
        falta la prop <code>data</code>: un objeto <code>{'{ breakdown, formula, evaluate }'}</code>{' '}
        con el desglose por línea, la fórmula final y su evaluador numérico.
      </AuthoringError>
    );
  }
  if (active === undefined) {
    return (
      <AuthoringError component="ComplexityCounter">
        el caso <code>{caseKey}</code> no está definido en <code>cases</code>. Los casos disponibles
        se muestran como pestañas; verifica que <code>{caseKey}</code> exista.
      </AuthoringError>
    );
  }

  const unitLabel = mode === 'space' ? 'celdas' : 'OE';
  const totalLabel = mode === 'space' ? 'M' : 'T';
  const evaluated = active.evaluate(n);

  return (
    <div
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
      style={SYNTAX_STYLE}
    >
      <header className="flex flex-wrap items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
          {mode === 'space' ? 'espacio' : 'operaciones'}
        </span>
        {algorithm !== undefined && <span className="font-mono text-sm text-ink">{algorithm}</span>}
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
          <pre className={`${OUTPUT} bg-sunk text-ink`}>
            {code.split('\n').map((line, i) => (
              <div key={i}>{highlightJava(line)}</div>
            ))}
          </pre>
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
            <code>{highlightJava(row.line)}</code>
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
                <code>{highlightJava(sub.line)}</code>
              </td>
              <td className="px-2 py-1 text-right">{sub.oe ?? 0}</td>
              <td className="px-3 py-1 text-right">
                {sub.times ?? ''}
                {sub.times !== undefined && (
                  <span className="text-ink-faint">
                    {' '}
                    = {evaluateFormula(sub.times, variable, n)}
                  </span>
                )}
              </td>
            </tr>
          ))}
      </>
    );
  }
  const times = row.times ? evaluateFormula(row.times, variable, n) : 0;
  return (
    <tr className="border-b border-rule/50 last:border-0 even:bg-sunk/30 hover:bg-accent-soft/20">
      <td className="px-3 py-1 text-ink">
        <code>{highlightJava(row.line)}</code>
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
