import { AuthoringError } from '../AuthoringError';

/**
 * A divide-and-conquer recipe. Named rather than function-valued so it survives
 * the MDX prop serialiser (same reason `<RecursionTree>`'s recipes are named,
 * ADR-0056). Each recipe carries the recurrence parameters (a subcalls of size
 * n/b plus a combine cost of the form O(n^fExp) with fExp ∈ {0, 1}) and its
 * human-facing header. The five recipes cover the deck's five uses:
 * `binary-search`, `max-array`, `max-subarray`, `closest-pair`, `karatsuba`.
 */
interface Recipe {
  /** Number of subcalls per non-base node. 1 for binary-search, 2 for the
   * four binary recipes, 3 for karatsuba. */
  a: number;
  /** Division factor: sub-problem size is `n/b`. All five recipes use b=2. */
  b: number;
  /** Combine cost exponent: 0 means f(n) = 1 (constant), 1 means f(n) = n
   * (linear). The two cases the class teaches — the Master Theorem
   * simplification does not need higher exponents at pregrado 2° año. */
  fExp: 0 | 1;
  /** Header string, e.g. "Máximo D&C: T(n) = 2T(n/2) + O(1)". Visible above
   * the tree. */
  header: string;
  /** Kind of the closed form. `constant-per-level` (case 2 of Master when
   * a·f(n/b) = f(n) for every level) is the pattern that produces n log n or
   * plain log n depending on f; `leaves-dominate` (case 1) produces n^log_b(a),
   * either plain n when a=b or the exponent-drop form for karatsuba. Named
   * discretely so the rail's Θ(...) is derived, never spelled by the recipe
   * (a typo in the closed form would silently ship a wrong claim). */
  closedFormKind: 'log-n' | 'n-log-n' | 'n' | 'n-log2-3';
}

const RECIPES: Record<string, Recipe> = {
  'binary-search': {
    a: 1,
    b: 2,
    fExp: 0,
    header: 'Búsqueda binaria: T(n) = T(n/2) + O(1)',
    closedFormKind: 'log-n',
  },
  'max-array': {
    a: 2,
    b: 2,
    fExp: 0,
    header: 'Máximo D&C: T(n) = 2T(n/2) + O(1)',
    closedFormKind: 'n',
  },
  'max-subarray': {
    a: 2,
    b: 2,
    fExp: 1,
    header: 'Max-subarray D&C: T(n) = 2T(n/2) + O(n)',
    closedFormKind: 'n-log-n',
  },
  'closest-pair': {
    a: 2,
    b: 2,
    fExp: 1,
    header: 'Closest pair D&C: T(n) = 2T(n/2) + O(n)',
    closedFormKind: 'n-log-n',
  },
  karatsuba: {
    a: 3,
    b: 2,
    fExp: 1,
    header: 'Karatsuba: T(n) = 3T(n/2) + O(n)',
    closedFormKind: 'n-log2-3',
  },
};

/**
 * The reader-facing text for each closed-form kind. Kept as a table so the
 * rail's footer and the widget's own tests read from one source, and so a
 * typo in the wording of Θ(...) is one edit rather than five (ADR-0058).
 */
const CLOSED_FORM_LABEL: Record<Recipe['closedFormKind'], string> = {
  'log-n': 'Θ(log n)',
  n: 'Θ(n)',
  'n-log-n': 'Θ(n log n)',
  // Karatsuba's exponent-drop. The `^{log_2 3}` form matches the header math
  // convention and the tests' regex; the decimal (≈ 1.585) is not on the chip
  // because the closed form belongs to the recipe, not to a specific browser.
  'n-log2-3': 'Θ(n^{log_2 3})',
};

/**
 * How many nodes the fully expanded tree may reach before the widget refuses to
 * render. karatsuba(n=32) is 364 and would demand a wider stage than any slide
 * has; karatsuba(n=16) at 121 nodes fits. The cap is the same shape as
 * `<RecursionTree>`'s and exists for the same reason — an authoring typo must
 * not freeze the tab.
 */
const MAX_NODES = 300;

/** Total node count of the fully unfolded tree, computed without allocating
 * one — the tree is regular, so the closed form (Σ a^i for i in 0..L) is
 * sufficient and cheap. */
function nodeCount(recipe: Recipe, n: number): number {
  const levels = Math.log(n) / Math.log(recipe.b);
  if (!Number.isInteger(levels)) return Number.POSITIVE_INFINITY;
  let total = 0;
  let atLevel = 1;
  for (let i = 0; i <= levels; i += 1) {
    total += atLevel;
    atLevel *= recipe.a;
  }
  return total;
}

/** True when `n` is exactly `b^k` for some non-negative integer k. */
function isPowerOf(n: number, b: number): boolean {
  if (!Number.isInteger(n) || n < 1) return false;
  let x = n;
  while (x > 1) {
    if (x % b !== 0) return false;
    x /= b;
  }
  return true;
}

export interface RecursionTreeDivideProps {
  /** Which of the five recipes to draw. Adding a recipe is a code change. */
  recipe?: string;
  /** Size of the root problem. Positive integer, and typically a power of the
   * recipe's `b` (all five recipes use `b=2`, so a power of 2). */
  n?: number;
  /** Header override; when absent, the recipe's default header is shown. */
  title?: string;
}

/**
 * The divide-and-conquer axis widget (ADR-0058).
 *
 * Draws the recursion tree of a D&C algorithm and the per-level cost rail so
 * the reader sees that the total cost is `work-per-level × number-of-levels`.
 * One component with five NAMED RECIPES; adding one is a code change, by
 * design (MDX props do not carry lambdas well). The widget only draws the
 * tree and the rail — the per-algorithm visualizers (`<BinarySearchOnArray>`,
 * `<MaxSubarrayViz>`, `<ClosestPairViz>`, `<KaratsubaViz>`) live as separate
 * components.
 */
export function RecursionTreeDivide({ recipe, n, title }: RecursionTreeDivideProps) {
  const known = recipe === undefined ? undefined : RECIPES[recipe];
  const recipeNames = Object.keys(RECIPES);

  if (recipe === undefined || known === undefined) {
    return (
      <AuthoringError component="RecursionTreeDivide">
        {recipe === undefined ? (
          <>
            falta la prop <code>recipe</code>. Recetas conocidas: {recipeNames.join(', ')}.
          </>
        ) : (
          <>
            «{recipe}» no está entre las recetas conocidas. Hoy son {recipeNames.join(', ')};
            agrégala en <code>RECIPES</code> si necesitas otra.
          </>
        )}
      </AuthoringError>
    );
  }

  if (n === undefined || !Number.isInteger(n) || n < 1) {
    return (
      <AuthoringError component="RecursionTreeDivide">
        la prop <code>n</code> tiene que ser un entero positivo.
      </AuthoringError>
    );
  }

  if (!isPowerOf(n, known.b)) {
    return (
      <AuthoringError component="RecursionTreeDivide">
        <code>n</code> tiene que ser una potencia de {known.b} para que la partición sea limpia en
        cada nivel (dibujar un árbol con hijos de tamaños distintos borra el punto pedagógico del
        Master simplificado).
      </AuthoringError>
    );
  }

  const size = nodeCount(known, n);
  if (size > MAX_NODES) {
    return (
      <AuthoringError component="RecursionTreeDivide">
        el árbol de {recipe} con <code>n={n}</code> es demasiado grande ({size}+ nodos, tope{' '}
        {MAX_NODES}). Usa un <code>n</code> menor — el punto pedagógico del riel de costos ya se ve
        con <code>n=8</code> o <code>n=16</code>.
      </AuthoringError>
    );
  }

  return <Body recipe={recipe} spec={known} n={n} title={title} />;
}

interface BodyProps {
  recipe: string;
  spec: Recipe;
  n: number;
  title?: string;
}

function Body({ recipe, spec, n, title }: BodyProps) {
  const levels = Math.round(Math.log(n) / Math.log(spec.b));
  const heading = title ?? spec.header;

  return (
    <figure
      data-recipe={recipe}
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          d&amp;c
        </span>
        <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
      </header>

      <div className="flex flex-col gap-4 px-3 py-6 md:flex-row md:items-start">
        <div className="flex-1 overflow-x-auto">
          <div className="flex min-w-fit justify-center font-mono text-xs">
            <Node spec={spec} size={n} />
          </div>
        </div>

        <CostRail spec={spec} n={n} levels={levels} />
      </div>

      <p className="border-t border-rule bg-sunk px-3 py-1.5 text-3xs text-ink-faint">
        El costo total sale de <em>trabajo por nivel</em> × <em>número de niveles</em>. El árbol es
        el microscopio; el Master Theorem simplificado es el atajo cuando el patrón ya se reconoce.
      </p>
    </figure>
  );
}

interface NodeProps {
  spec: Recipe;
  size: number;
}

/**
 * One node of the tree. Non-base nodes render as a chip with an inline combine
 * cost when `f > 0` (max-subarray, closest-pair, karatsuba) or a bare `T(k)`
 * chip when `f = 0` (binary-search, max-array). Base cases (size 1) render as
 * a muted, rounded chip — the visual distinction says "no more recursion here"
 * without adding a separate label.
 */
function Node({ spec, size }: NodeProps) {
  const isBase = size <= 1;
  const label = isBase
    ? 'T(1)'
    : spec.fExp === 0
      ? `T(${size})`
      : `T(${size})·O(${combineOf(size, spec.fExp)})`;

  const chipClass = isBase
    ? 'inline-flex items-center rounded-full border border-rule bg-sunk px-2 py-0.5 text-ink-faint'
    : 'inline-flex items-center rounded border border-accent bg-accent-soft px-2 py-0.5 text-ink';

  if (isBase) {
    return (
      <span className={`${chipClass} whitespace-nowrap`} data-size={size}>
        {label}
      </span>
    );
  }

  const children: number[] = Array.from({ length: spec.a }, () => size / spec.b);

  return (
    <div className="flex flex-col items-center">
      <span className={`${chipClass} whitespace-nowrap`} data-size={size}>
        {label}
      </span>
      <div
        className={
          'relative flex justify-center pt-6 ' +
          "before:absolute before:top-0 before:left-1/2 before:h-6 before:w-px before:bg-rule before:content-['']"
        }
      >
        {children.map((childSize, i) => {
          const only = children.length === 1;
          const first = i === 0;
          const last = i === children.length - 1;
          const barSide = only
            ? 'before:hidden'
            : first
              ? 'before:left-1/2 before:right-0'
              : last
                ? 'before:left-0 before:right-1/2'
                : 'before:left-0 before:right-0';
          return (
            <div
              key={i}
              className={
                'relative flex flex-col items-center px-3 pt-6 ' +
                "before:absolute before:top-0 before:h-px before:bg-rule before:content-[''] " +
                "after:absolute after:top-0 after:left-1/2 after:h-6 after:w-px after:bg-rule after:content-[''] " +
                barSide
              }
            >
              <Node spec={spec} size={childSize} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface CostRailProps {
  spec: Recipe;
  n: number;
  levels: number;
}

/**
 * The per-level cost breakdown, rendered as a small `<table>` (a genuine
 * tabular reading: one row per level with three columns — nodes at that level,
 * combine cost per node, level total). The closed form Θ(...) is the `<tfoot>`
 * — the pattern the four rows above lead to. Concrete numbers, not symbolic
 * (a symbolic rail would duplicate what the header's recurrence already says,
 * per ADR-0058).
 */
function CostRail({ spec, n, levels }: CostRailProps) {
  const rows: { level: number; nodes: number; combine: number; total: number }[] = [];
  let nodesAtLevel = 1;
  for (let L = 0; L <= levels; L += 1) {
    const sizeAtLevel = n / Math.pow(spec.b, L);
    const combine = combineOf(sizeAtLevel, spec.fExp);
    rows.push({
      level: L,
      nodes: nodesAtLevel,
      combine,
      total: nodesAtLevel * combine,
    });
    nodesAtLevel *= spec.a;
  }

  const closedForm = CLOSED_FORM_LABEL[spec.closedFormKind];

  return (
    <table
      aria-label="Costo por nivel"
      className="min-w-fit shrink-0 border-collapse font-mono text-xs md:border-l md:border-rule md:pl-4"
    >
      <thead>
        <tr className="text-ink-faint">
          <th className="px-2 py-1 text-left font-normal">Nivel</th>
          <th className="px-2 py-1 text-right font-normal">nodos</th>
          <th className="px-2 py-1 text-right font-normal">×</th>
          <th className="px-2 py-1 text-right font-normal">combine</th>
          <th className="px-2 py-1 text-right font-normal">=</th>
          <th className="px-2 py-1 text-right font-normal">total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.level} className="border-t border-rule/50">
            <td className="px-2 py-1 text-left">Nivel {row.level}</td>
            <td className="px-2 py-1 text-right">{row.nodes}</td>
            <td className="px-2 py-1 text-right text-ink-faint">×</td>
            <td className="px-2 py-1 text-right">O({row.combine})</td>
            <td className="px-2 py-1 text-right text-ink-faint">=</td>
            <td className="px-2 py-1 text-right">{row.total}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-rule">
          <td className="px-2 py-1 text-left text-ink-faint" colSpan={5}>
            Total
          </td>
          <td className="px-2 py-1 text-right font-medium text-accent">{closedForm}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** The combine cost O(f(k)) as a bare number: f(k) = 1 when fExp = 0, k when
 * fExp = 1. Both are the only forms the class teaches and the only ones the
 * five recipes need. */
function combineOf(size: number, fExp: 0 | 1): number {
  return fExp === 0 ? 1 : size;
}
