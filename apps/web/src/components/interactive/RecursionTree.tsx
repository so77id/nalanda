import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { AuthoringError } from '../AuthoringError';

/**
 * A node's state. For linear/tree-shaped numeric recursions (`fib`,
 * `factorial`), the state is just `{ n }`. For recursions whose arguments
 * carry more than the size — Hanoi's four-tower call `hanoi(n, from, to,
 * aux)` — the extras array holds the additional non-numeric arguments that
 * differentiate two calls with the same `n`. Extras is what makes Hanoi's
 * tree distinct at every node even though `n` decreases the same way.
 */
export interface NodeState {
  n: number;
  extras?: string[];
}

/**
 * The recipes the tree knows how to unfold. Named rather than function-valued
 * because MDX props pass through the serializer, and a lambda in a fence would
 * be worse for the author than the small set of names actually used in the
 * course.
 */
type Recipe = {
  /** How each node reads: `format(state)`. */
  format: (state: NodeState) => string;
  /** The subcalls a node with this state makes. Empty means base case. */
  children: (state: NodeState) => NodeState[];
  /** Convert the top-level `arg` number prop into the root state. */
  seed: (arg: number) => NodeState;
  /**
   * How to colour nodes. `by-arg` cycles through hues by `n` — the visual
   * signal that fib(3) appearing multiple times is the SAME call (ADR of
   * the original widget). `uniform` paints every node with the same accent
   * hue — the visual signal that in Hanoi no two calls repeat (ADR-0051).
   */
  colorStrategy: 'by-arg' | 'uniform';
};

const RECIPES: Record<string, Recipe> = {
  fib: {
    format: ({ n }) => `fib(${n})`,
    children: ({ n }) => (n < 2 ? [] : [{ n: n - 1 }, { n: n - 2 }]),
    seed: (n) => ({ n }),
    colorStrategy: 'by-arg',
  },
  factorial: {
    format: ({ n }) => `factorial(${n})`,
    children: ({ n }) => (n <= 1 ? [] : [{ n: n - 1 }]),
    seed: (n) => ({ n }),
    colorStrategy: 'by-arg',
  },
  hanoi: {
    format: ({ n, extras }) => {
      const [from = 'A', to = 'C'] = extras ?? [];
      return `hanoi(${n}, ${from}→${to})`;
    },
    children: ({ n, extras }) => {
      if (n === 0) return [];
      const [from = 'A', to = 'C', aux = 'B'] = extras ?? [];
      return [
        { n: n - 1, extras: [from, aux, to] },
        { n: n - 1, extras: [aux, to, from] },
      ];
    },
    seed: (n) => ({ n, extras: ['A', 'C', 'B'] }),
    colorStrategy: 'uniform',
  },
};

/**
 * How many nodes the fully-expanded tree may reach before the component refuses
 * to render. fib(15) is 1973 nodes and fib(20) is 21891 — the browser can draw
 * them, but no reader would click through them, and the pedagogical point is
 * made at fib(5). The cap is generous so an author can explore in `/catalog`
 * without seeing this error every third try, and small enough that a typo in
 * the fence does not freeze the tab (this component is not the demo — the
 * demo lives in `<CodeEditor>` beside it in §8, capped at n=35 on purpose).
 */
const MAX_NODES = 300;

function nodeCount(recipe: Recipe, arg: number): number {
  const stack: NodeState[] = [recipe.seed(arg)];
  let count = 0;
  while (stack.length > 0) {
    if (count > MAX_NODES) return count;
    const next = stack.pop()!;
    count += 1;
    for (const child of recipe.children(next)) stack.push(child);
  }
  return count;
}

export interface RecursionTreeProps {
  /** Which recursion pattern to draw. Today: `fib` or `factorial`. */
  recipe?: string;
  /** The argument to the root call. Non-negative integer. */
  arg?: number;
  /** Heading shown in the tree's header, e.g. `fib(5)`. */
  title?: string;
}

/**
 * A drawing of a recursive call, expanded one click at a time.
 *
 * The tree opens closed: only the root shows. A click on any interior node
 * reveals its own subcalls, a second click hides them again. Base cases (the
 * arguments where the recipe stops recursing) are visible once revealed and
 * cannot be clicked into further.
 *
 * Nodes carrying the same argument share a colour, so the DUPLICATION that
 * makes recursive Fibonacci slow becomes VISIBLE as the reader expands, rather
 * than asserted in the prose. The colour is picked from the resolved theme
 * rather than a raw Tailwind class: this component is rendered inside pages
 * that ship in both themes, and inline styles pick a legible pair for each.
 * The design-system guard covers `bg-*-500` shapes, not `style` attributes.
 * design-system.md §"A component-scoped categorical palette" is the exemption
 * that carries this decision; the token alternative — three CSS blocks × six
 * hues — buys nothing scoped to one component and no pair meaningful outside
 * this tree.
 *
 * **Colour is never the only signal** (design-system.md): each node shows its
 * argument in the label as well, so a reader who cannot distinguish hues still
 * sees "fib(3) again".
 */
export function RecursionTree({ recipe, arg, title }: RecursionTreeProps) {
  const known = recipe === undefined ? undefined : RECIPES[recipe];

  if (recipe === undefined || known === undefined) {
    const recipeNames = Object.keys(RECIPES);
    return (
      <AuthoringError component="RecursionTree">
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

  if (arg === undefined || !Number.isInteger(arg) || arg < 0) {
    return (
      <AuthoringError component="RecursionTree">
        la prop <code>arg</code> tiene que ser un entero no negativo.
      </AuthoringError>
    );
  }

  const size = nodeCount(known, arg);
  if (size > MAX_NODES) {
    const rootLabel = known.format(known.seed(arg));
    return (
      <AuthoringError component="RecursionTree">
        el árbol de {rootLabel} es demasiado grande ({size}+ nodos, tope {MAX_NODES}). Este
        componente es para ilustrar la duplicación de subcallas, no para dibujar el árbol completo —
        usa un <code>arg</code> menor (fib(5) es el ejemplo del curso) o mide el crecimiento con{' '}
        <code>&lt;CodeEditor&gt;</code>.
      </AuthoringError>
    );
  }

  return <TreeBody recipe={known} arg={arg} title={title} />;
}

interface TreeBodyProps {
  recipe: Recipe;
  arg: number;
  title?: string;
}

/**
 * Every interior-node path in the tree, seeded so the tree renders open.
 *
 * The issue's original §Design opened the tree closed and asked the reader to
 * expand it; on the built page that looked like a broken widget rather than a
 * teaching aid, and Miguel called it out at review — the reader gets more from
 * SEEING the duplication all at once than from unfolding it click by click.
 * The click-to-collapse behaviour stays (a reader who wants to focus on a
 * subtree can hide siblings), only the initial state flipped.
 */
function allInteriorPaths(recipe: Recipe, arg: number): Set<string> {
  const paths = new Set<string>();
  const walk = (state: NodeState, path: string) => {
    const kids = recipe.children(state);
    if (kids.length === 0) return;
    paths.add(path);
    kids.forEach((child, i) => walk(child, `${path}.${i}`));
  };
  walk(recipe.seed(arg), 'r');
  return paths;
}

function TreeBody({ recipe, arg, title }: TreeBodyProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => allInteriorPaths(recipe, arg));
  const theme = useResolvedTheme();

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const paint = useMemo(() => paintFor(theme, recipe.colorStrategy), [theme, recipe.colorStrategy]);
  const rootState = useMemo(() => recipe.seed(arg), [recipe, arg]);
  const footer =
    recipe.colorStrategy === 'uniform'
      ? 'Cada llamada produce un efecto en el problema (mover un disco) — el trabajo es intrínseco a Hanoi y no se puede evitar cacheando. Cliquea un nodo para ocultar sus subcallas si quieres enfocarte en una parte.'
      : 'Los nodos con el mismo argumento comparten color — la duplicación es lo que hace lento al recursivo. Cliquea un nodo para ocultar sus subcallas si quieres enfocarte en una parte.';

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          recursión
        </span>
        {title === undefined ? null : <h4 className="m-0 text-sm font-medium text-ink">{title}</h4>}
      </header>

      <div className="flex justify-center overflow-x-auto px-3 py-6 font-mono text-sm">
        <Node
          recipe={recipe}
          state={rootState}
          path="r"
          expanded={expanded}
          toggle={toggle}
          paint={paint}
        />
      </div>

      <p className="border-t border-rule bg-sunk px-3 py-1.5 text-3xs text-ink-faint">{footer}</p>
    </figure>
  );
}

interface NodeProps {
  recipe: Recipe;
  state: NodeState;
  path: string;
  expanded: Set<string>;
  toggle: (path: string) => void;
  paint: (arg: number) => { background: string; border: string; color: string };
}

function Node({ recipe, state, path, expanded, toggle, paint }: NodeProps) {
  const children = recipe.children(state);
  const isBase = children.length === 0;
  const isOpen = expanded.has(path);
  const label = recipe.format(state);
  const style = paint(state.n);

  const chip = isBase ? (
    <span
      data-arg={state.n}
      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs whitespace-nowrap"
      style={style}
    >
      {label}
    </span>
  ) : (
    <button
      type="button"
      data-arg={state.n}
      onClick={() => toggle(path)}
      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      style={style}
      aria-expanded={isOpen}
    >
      {isOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
      {label}
    </button>
  );

  const showChildren = isOpen && children.length > 0;

  return (
    // Classic-tree layout: the chip sits centred on top, subcalls fan out
    // beneath it in a row, and CSS pseudo-elements draw the connector lines.
    // The parent's ::before is the vertical stub going down from the chip;
    // each child's ::before is the horizontal bar half-segment (nothing on
    // a single child), and each child's ::after is the vertical stub coming
    // up to its own chip. All lines paint in `bg-rule` (a decorative
    // separator with no contrast floor — design-system.md §The tokens).
    <div className="flex flex-col items-center">
      {chip}
      {showChildren ? (
        // The horizontal bar between siblings is drawn as ::before on each
        // child — `gap-` would leave visual breaks, so siblings use inner
        // horizontal padding (`px-3`) instead and touch at their borders,
        // making the concatenated ::before line unbroken from center of the
        // first child to center of the last.
        <div className="relative flex justify-center pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:w-px before:bg-rule before:content-['']">
          {children.map((childState, i) => {
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
                key={`${path}.${i}`}
                className={`relative flex flex-col items-center px-3 pt-6 before:absolute before:top-0 before:h-px before:bg-rule before:content-[''] after:absolute after:top-0 after:left-1/2 after:h-6 after:w-px after:bg-rule after:content-[''] ${barSide}`}
              >
                <Node
                  recipe={recipe}
                  state={childState}
                  path={`${path}.${i}`}
                  expanded={expanded}
                  toggle={toggle}
                  paint={paint}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The colour a node picks for its argument, in the theme this browser paints.
 *
 * Same shape as `CodeEditor` and `Exercise` take their editor theme through
 * `useResolvedTheme`: the resolved theme is the SSOT for anything CSS variables
 * cannot express — here, a per-argument hue that has to be legible on both
 * grounds. Six hues cycle through the argument; fib(5) reaches arguments 0–5
 * and every one gets a distinct pair. Beyond that (factorial(4) reaches 1–4,
 * MAX_NODES caps the rest) the cycle repeats — the point is visible sharing,
 * not perfect uniqueness.
 *
 * The pairs are picked for a low-saturation, mid-lightness look that reads on
 * `surface` in both themes; the border is a stronger cut so the shape is
 * carried by the border and the fill is atmosphere (colour is never the only
 * signal). The label itself is legible against the fill by construction: on
 * light, dark ink on a soft tint; on dark, light ink on a deeper tint. Both
 * pairs land above 4.5:1 by inspection; the S7 browser check confirms them
 * against the live tokens.
 */
function paintFor(theme: 'light' | 'dark', strategy: 'by-arg' | 'uniform') {
  const HUE_STEP = 60;
  return (arg: number) => {
    // Uniform strategy picks a fixed hue (blue-ish) for every node — the
    // pedagogical signal that no two nodes carry the same call (e.g. Hanoi).
    // by-arg cycles hues so duplicated arguments share a colour (fib).
    const hue = strategy === 'uniform' ? 220 : (arg * HUE_STEP) % 360;
    if (theme === 'dark') {
      return {
        background: `hsl(${hue} 30% 22%)`,
        border: `1px solid hsl(${hue} 55% 55%)`,
        color: 'hsl(0 0% 92%)',
      };
    }
    return {
      background: `hsl(${hue} 50% 92%)`,
      border: `1px solid hsl(${hue} 55% 45%)`,
      color: 'hsl(0 0% 12%)',
    };
  };
}
