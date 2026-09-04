import { AuthoringError } from '../AuthoringError';
import { lomutoPartition, quicksortCallLabel } from './sortStepperTrace';

/**
 * A recursion-tree node with two flows visible: the CALL (arguments going
 * down) and the RETURN VALUE (result going up). The tree is the visual
 * counterpart of the "hourglass" abstract diagram used earlier in the deck —
 * the divide-and-combine dynamic made concrete on real data.
 */
interface TreeNode {
  /** The call label shown on the top row of the chip (e.g. "max([3,7])" or
   * "bs([22,28], lo=5, hi=6)"). */
  call: string;
  /** The return value shown on the bottom row (e.g. "7" or "-1"). Empty
   * string when the branch was not explored (dimmed = true). */
  returnValue: string;
  /** True if this call resolves directly without recursing. */
  isBase: boolean;
  /** True for the BS branches the algorithm did NOT walk — drawn but
   * greyed out so the reader sees the "here is the branch we did not
   * take" context without cluttering the tree with a full unexplored
   * subtree. */
  dimmed?: boolean;
  /** Optional per-node intermediate values shown as a middle row on the
   * chip. Used by `max-subarray` to expose left/right/cross candidates
   * so the reader sees what the combine compared before choosing the
   * winner. Not shown on base-case leaves. */
  intermediates?: { label: string; value: string }[];
  /** Zero children = base case; one child = only-one-side (BS at leaf);
   * two children = binary tree (max always; BS at internal nodes, one
   * side of which is dimmed). */
  children: TreeNode[];
}

type BuildInput = { values: number[]; target?: number };
type Recipe = { build: (input: BuildInput) => TreeNode };

/** Max subarray sum + which sub-range achieves it. */
interface SubarrayResult {
  sum: number;
  from: number;
  to: number;
}
function pickBest(...candidates: SubarrayResult[]): SubarrayResult {
  let best = candidates[0]!;
  for (const c of candidates) if (c.sum > best.sum) best = c;
  return best;
}

/** Cap the total node count so an authoring typo can't freeze the tab. Max
 * on 32 elements is 63 nodes — comfortably under. On 64 elements it's 127,
 * which blows the cap. */
const MAX_NODES = 100;

/** Parse `"[3,7,1]"` back into `[3, 7, 1]`. Used by mergesort/quicksort
 * recipes to walk the sorted returnValues their children emit. */
function parseArray(s: string): number[] {
  const inner = s.slice(1, -1);
  if (inner.length === 0) return [];
  return inner.split(',').map((x) => Number(x));
}

/** Classic O(n+m) merge of two sorted arrays. */
function merge(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]! <= b[j]!) {
      out.push(a[i]!);
      i += 1;
    } else {
      out.push(b[j]!);
      j += 1;
    }
  }
  while (i < a.length) {
    out.push(a[i]!);
    i += 1;
  }
  while (j < b.length) {
    out.push(b[j]!);
    j += 1;
  }
  return out;
}

const RECIPES: Record<string, Recipe> = {
  max: {
    build: ({ values }) => {
      function build(lo: number, hi: number): TreeNode {
        const slice = values.slice(lo, hi + 1);
        const call = `max([${slice.join(',')}])`;
        if (lo === hi) {
          return { call, returnValue: `${values[lo]}`, isBase: true, children: [] };
        }
        const mid = Math.floor((lo + hi) / 2);
        const left = build(lo, mid);
        const right = build(mid + 1, hi);
        const winner = Math.max(Number(left.returnValue), Number(right.returnValue));
        return {
          call,
          returnValue: `${winner}`,
          isBase: false,
          children: [left, right],
        };
      }
      return build(0, values.length - 1);
    },
  },
  'max-subarray': {
    build: ({ values }) => {
      function callLabel(lo: number, hi: number): string {
        return `maxSub([${values.slice(lo, hi + 1).join(',')}])`;
      }

      function build(lo: number, hi: number): { node: TreeNode; result: SubarrayResult } {
        const call = callLabel(lo, hi);
        if (lo === hi) {
          const result = { sum: values[lo]!, from: lo, to: lo };
          return {
            node: { call, returnValue: `${result.sum}`, isBase: true, children: [] },
            result,
          };
        }
        const mid = Math.floor((lo + hi) / 2);
        const left = build(lo, mid);
        const right = build(mid + 1, hi);
        // Cross: best suffix ending at mid + best prefix starting at mid+1.
        let sum = 0;
        let leftBest: SubarrayResult = { sum: -Infinity, from: mid, to: mid };
        for (let i = mid; i >= lo; i -= 1) {
          sum += values[i]!;
          if (sum > leftBest.sum) leftBest = { sum, from: i, to: mid };
        }
        sum = 0;
        let rightBest: SubarrayResult = { sum: -Infinity, from: mid + 1, to: mid + 1 };
        for (let j = mid + 1; j <= hi; j += 1) {
          sum += values[j]!;
          if (sum > rightBest.sum) rightBest = { sum, from: mid + 1, to: j };
        }
        const cross: SubarrayResult = {
          sum: leftBest.sum + rightBest.sum,
          from: leftBest.from,
          to: rightBest.to,
        };
        const winner = pickBest(left.result, right.result, cross);
        return {
          node: {
            call,
            returnValue: `${winner.sum}`,
            isBase: false,
            intermediates: [
              { label: 'L', value: `${left.result.sum}` },
              { label: 'R', value: `${right.result.sum}` },
              { label: '✕', value: `${cross.sum}` },
            ],
            children: [left.node, right.node],
          },
          result: winner,
        };
      }
      return build(0, values.length - 1).node;
    },
  },
  mergesort: {
    build: ({ values }) => {
      function build(lo: number, hi: number): TreeNode {
        const slice = values.slice(lo, hi + 1);
        const call = `mergesort([${slice.join(',')}])`;
        if (lo === hi) {
          return {
            call,
            returnValue: `[${values[lo]}]`,
            isBase: true,
            children: [],
          };
        }
        const mid = Math.floor((lo + hi) / 2);
        const left = build(lo, mid);
        const right = build(mid + 1, hi);
        // Merge the two sorted subarrays returned by children.
        const leftSorted = parseArray(left.returnValue);
        const rightSorted = parseArray(right.returnValue);
        const merged = merge(leftSorted, rightSorted);
        return {
          call,
          returnValue: `[${merged.join(',')}]`,
          isBase: false,
          children: [left, right],
        };
      }
      return build(0, values.length - 1);
    },
  },
  quicksort: {
    build: ({ values }) => {
      // Uses the SAME Lomuto in-place partition the SortStepper trace does,
      // so the tree's chip labels match the stepper's subarrays exactly
      // (see sortStepperTrace.ts §quicksortCallTree). Deterministic pivot =
      // first element of the subarray, the pedagogical choice explained in
      // the deck (stdlib uses shuffle + median-of-3 as a practical fix; the
      // widget shows the PATTERN of partitioning, not the production
      // choice).
      const a = [...values];

      function build(lo: number, hi: number): TreeNode {
        const slice = a.slice(lo, hi + 1);
        const call = quicksortCallLabel(slice, lo, hi);
        if (lo >= hi) {
          return {
            call,
            returnValue: `[${slice.join(',')}]`,
            isBase: true,
            children: [],
          };
        }
        const pivot = a[lo]!;
        const p = lomutoPartition(a, lo, hi);
        const leftNode = build(lo, p - 1);
        const rightNode = build(p + 1, hi);
        return {
          call,
          returnValue: `[${a.slice(lo, hi + 1).join(',')}]`,
          isBase: false,
          intermediates: [{ label: 'pivot', value: `${pivot}` }],
          children: [leftNode, rightNode],
        };
      }
      return build(0, a.length - 1);
    },
  },
  'binary-search': {
    build: ({ values, target }) => {
      function callLabel(lo: number, hi: number): string {
        const slice = lo > hi ? '[]' : `[${values.slice(lo, hi + 1).join(',')}]`;
        return `bs(${slice}, lo=${lo}, hi=${hi})`;
      }

      /** Build the ENTIRE unvisited subtree greyed out — including the
       * empty-range chips (bs([], lo=X, hi=X-1)) so every internal node
       * shows BOTH of its halves and the tree reads as structurally
       * complete. The dimmed contrast against the taken chain makes the
       * "BS walks ONE path" idea visible. */
      function buildDimmedSubtree(lo: number, hi: number): TreeNode {
        const call = callLabel(lo, hi);
        if (lo > hi) {
          return { call, returnValue: '', isBase: true, dimmed: true, children: [] };
        }
        if (lo === hi) {
          return { call, returnValue: '', isBase: true, dimmed: true, children: [] };
        }
        const mid = Math.floor((lo + hi) / 2);
        const leftChild = buildDimmedSubtree(lo, mid - 1);
        const rightChild = buildDimmedSubtree(mid + 1, hi);
        return {
          call,
          returnValue: '',
          isBase: false,
          dimmed: true,
          children: [leftChild, rightChild],
        };
      }

      function build(lo: number, hi: number): TreeNode {
        const call = callLabel(lo, hi);
        if (lo > hi) {
          return { call, returnValue: '-1', isBase: true, children: [] };
        }
        if (lo === hi) {
          const found = values[lo]! === target;
          return { call, returnValue: found ? `${lo}` : '-1', isBase: true, children: [] };
        }
        const mid = Math.floor((lo + hi) / 2);
        if (values[mid]! === target) {
          return { call, returnValue: `${mid}`, isBase: true, children: [] };
        }
        // BS walks ONE side. Draw the taken side recursively (highlighted)
        // and the not-taken side as a FULL dimmed subtree — the reader sees
        // the whole potential of the tree, and the contrast between the
        // taken chain and the dimmed subtrees makes visible that BS
        // explores only a $$\Theta(\log N)$$-long chain, not the whole
        // tree.
        const takingRight = values[mid]! < target!;
        const leftLo = lo;
        const leftHi = mid - 1;
        const rightLo = mid + 1;
        const rightHi = hi;
        const leftChild = takingRight ? buildDimmedSubtree(leftLo, leftHi) : build(leftLo, leftHi);
        const rightChild = takingRight
          ? build(rightLo, rightHi)
          : buildDimmedSubtree(rightLo, rightHi);
        const taken = takingRight ? rightChild : leftChild;
        return {
          call,
          returnValue: taken.returnValue,
          isBase: false,
          children: [leftChild, rightChild],
        };
      }
      return build(0, values.length - 1);
    },
  },
};

function countNodes(node: TreeNode): number {
  let count = 1;
  for (const child of node.children) count += countNodes(child);
  return count;
}

function isStrictlyIncreasing(a: number[]): boolean {
  for (let i = 1; i < a.length; i += 1) {
    if (a[i]! <= a[i - 1]!) return false;
  }
  return true;
}

export interface DivideCombineTreeProps {
  /** Which recipe to draw. Today: `max`, `max-subarray`, `binary-search`,
   * `mergesort`, `quicksort`. */
  recipe?: string;
  /** The input array. For `binary-search`, must be strictly increasing. */
  values?: number[];
  /** For `binary-search` only: the value being searched. */
  target?: number;
  /** Header override. */
  title?: string;
  /** When set, the chip whose `call` matches this string is rendered with a
   * focus ring and exposes `data-highlighted="true"`. Used by `<SortStepper>`
   * to point at the call the stepper is currently executing. */
  highlightNode?: string;
  /** Optional per-chip middle-row overrides, keyed by the chip's `call`.
   * When a chip's call is a key, the given string replaces the chip's
   * middle row (which otherwise carries the recipe's default: pivot for
   * quicksort, nothing for mergesort, L/R/✕ for max-subarray). */
  nodeAnnotations?: Record<string, string>;
  /** The recursion stack this frame — deepest last. When set, chips
   * whose `call` is not on the stack AND not in `doneNodes` render as
   * "pendiente" (the recursion has not reached them yet, no return
   * value visible); chips on the stack but NOT deepest render as
   * "esperando" (called but waiting on children); the deepest one gets
   * the active affordance (same as `highlightNode`). Used by
   * `<SortStepper>` to tell the story of playback through the tree. */
  activeStack?: string[];
  /** Chips whose `call` matches one of these are painted as "listo" —
   * they returned in a previous frame and show their return value. */
  doneNodes?: string[];
  /** Chip typography density. `md` (default, ~12 px, `px-2 py-1`) is the
   * general-purpose size that fits `<SortStepper>`'s bottom row for
   * mergesort/quicksort trees. `sm` (~10 px, `px-1.5 py-0.5`) is ~20 %
   * more compact — used when the tree stands alone in a slide and the
   * default size overflows the reading column (e.g. "La cuenta sale del
   * árbol" for mergesort). */
  chipSize?: 'md' | 'sm';
  /** When true, render only the tree chips — no `<figure>` chrome (header,
   * border, footer). For host widgets that render the tree inside their
   * own frame (e.g. `<SortStepper>`), so the reader does not see "a widget
   * inside a widget". */
  bare?: boolean;
  /** Tree growth axis. `vertical` (default) = root on top, children fan
   * out below — classic textbook layout for `max`, `max-subarray`,
   * `binary-search`. `horizontal` = root on the left, children stack
   * vertically on the right — used for the deep `mergesort` /
   * `quicksort` trees whose vertical layout is too wide for a slide;
   * the reader's eye follows depth left-to-right and each level occupies
   * a column instead of a row. */
  orientation?: 'vertical' | 'horizontal';
}

/**
 * The divide-combine recursion-tree widget (ADR-0063).
 *
 * Each chip has TWO rows: the call arguments (top, what was DIVIDED into this
 * call) and the return value (bottom, what this call COMBINES back UP). The
 * shape of the tree carries the pedagogy: `max` renders a wide binary tree
 * (2^L nodes at level L, one leaf per input element) — the "leaves dominate"
 * pattern that gives `max` its Θ(N). `binary-search` renders a linear chain
 * (one call per level, only the path taken) — the "cadena logarítmica" that
 * gives BS its Θ(log N).
 */
export function DivideCombineTree({
  recipe,
  values,
  target,
  title,
  highlightNode,
  nodeAnnotations,
  activeStack,
  doneNodes,
  chipSize = 'md',
  bare = false,
  orientation = 'vertical',
}: DivideCombineTreeProps) {
  const effectiveOrientation = orientation;
  const known = recipe === undefined ? undefined : RECIPES[recipe];
  const recipeNames = Object.keys(RECIPES);

  if (recipe === undefined || known === undefined) {
    return (
      <AuthoringError component="DivideCombineTree">
        {recipe === undefined ? (
          <>
            falta la prop <code>recipe</code>. Recetas conocidas: {recipeNames.join(', ')}.
          </>
        ) : (
          <>
            «{recipe}» no es una receta conocida. Hoy son {recipeNames.join(', ')}.
          </>
        )}
      </AuthoringError>
    );
  }

  if (values === undefined || values.length === 0) {
    return (
      <AuthoringError component="DivideCombineTree">
        falta la prop <code>values</code> (arreglo no vacío).
      </AuthoringError>
    );
  }

  if (recipe === 'binary-search') {
    if (target === undefined || !Number.isInteger(target)) {
      return (
        <AuthoringError component="DivideCombineTree">
          la receta <code>binary-search</code> requiere la prop <code>target</code> (entero).
        </AuthoringError>
      );
    }
    if (!isStrictlyIncreasing(values)) {
      return (
        <AuthoringError component="DivideCombineTree">
          <code>values</code> tiene que estar ordenado estrictamente creciente para{' '}
          <code>binary-search</code>.
        </AuthoringError>
      );
    }
  }

  const root = known.build({ values, target });
  const size = countNodes(root);
  if (size > MAX_NODES) {
    return (
      <AuthoringError component="DivideCombineTree">
        el árbol de {recipe} con {values.length} elementos es demasiado grande ({size} nodos, tope{' '}
        {MAX_NODES}). Usá un arreglo menor — el punto pedagógico se ve bien con 4-8 elementos.
      </AuthoringError>
    );
  }

  const heading = title ?? headingFor(recipe, values.length, target);

  if (bare) {
    // Chrome-less: host widget provides the frame (header, border,
    // footer). Emitting the chips alone keeps `<SortStepper>` from
    // reading as "a widget inside a widget".
    return (
      <div data-recipe={recipe} className="flex justify-center overflow-x-auto">
        <Node
          node={root}
          highlightNode={highlightNode}
          nodeAnnotations={nodeAnnotations}
          activeStack={activeStack}
          doneNodes={doneNodes}
          chipSize={chipSize}
          orientation={effectiveOrientation}
        />
      </div>
    );
  }

  return (
    <figure
      data-recipe={recipe}
      // `flex-col` on the figure + `flex-1` on the tree container below
      // lets the tree centre vertically when the figure is stretched by
      // a sibling (SideBySide balanced-vs-degenerate). `h-full` makes
      // the figure fill its flex parent's height when one exists (the
      // SideBySide Column stretches on the grid row); when the figure
      // is a natural-height standalone in prose, h-full collapses to
      // content because the parent has no fixed height.
      className="not-prose my-6 flex h-full w-full flex-col overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex flex-col gap-0.5 bg-sunk px-2 py-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
            d/c
          </span>
          <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
        </div>
        {recipe === 'binary-search' ? (
          <div className="font-mono text-3xs text-ink-faint">target = {target}</div>
        ) : null}
      </header>

      <div className="flex flex-1 items-center justify-center overflow-x-auto px-3 py-6">
        <Node
          node={root}
          highlightNode={highlightNode}
          nodeAnnotations={nodeAnnotations}
          activeStack={activeStack}
          doneNodes={doneNodes}
          chipSize={chipSize}
          orientation={effectiveOrientation}
        />
      </div>

      <p className="border-t border-rule bg-sunk px-2 py-1 text-3xs text-ink-faint">
        En cada chip: <strong className="text-ink">arriba</strong> la llamada (lo que <em>baja</em>,
        el subproblema), <strong className="text-ink">abajo</strong> el valor retornado (lo que{' '}
        <em>sube</em>, el combine).
      </p>
    </figure>
  );
}

function headingFor(recipe: string, n: number, target?: number): string {
  if (recipe === 'max') return `Árbol divide/combine · máximo sobre ${n} elementos`;
  if (recipe === 'binary-search')
    return `Árbol divide/combine · búsqueda binaria de ${target} sobre ${n} elementos`;
  if (recipe === 'max-subarray') return `Árbol divide/combine · max-subarray sobre ${n} elementos`;
  if (recipe === 'mergesort') return `Árbol divide/combine · mergesort sobre ${n} elementos`;
  if (recipe === 'quicksort') return `Árbol divide/combine · quicksort sobre ${n} elementos`;
  return `Árbol divide/combine · ${recipe}`;
}

interface NodeProps {
  node: TreeNode;
  highlightNode?: string;
  nodeAnnotations?: Record<string, string>;
  activeStack?: string[];
  doneNodes?: string[];
  chipSize?: 'md' | 'sm';
  /** Tree growth axis. `vertical` = root on top, children fan out below
   * (classic textbook layout — max/max-subarray/binary-search).
   * `horizontal` = root on the left, children stack vertically on the
   * right (used for the deep mergesort/quicksort trees, where vertical
   * layout is too wide for the slide). */
  orientation?: 'vertical' | 'horizontal';
}

function Node({
  node,
  highlightNode,
  nodeAnnotations,
  activeStack,
  doneNodes,
  chipSize = 'md',
  orientation = 'vertical',
}: NodeProps) {
  const chip = (
    <Chip
      node={node}
      highlightNode={highlightNode}
      nodeAnnotations={nodeAnnotations}
      activeStack={activeStack}
      doneNodes={doneNodes}
      chipSize={chipSize}
    />
  );

  if (node.children.length === 0) {
    return (
      <div
        className={
          orientation === 'horizontal' ? 'flex flex-row items-center' : 'flex flex-col items-center'
        }
      >
        {chip}
      </div>
    );
  }

  if (orientation === 'horizontal') {
    // Horizontal layout: chip on the left, subcalls stack vertically on
    // the right, and CSS pseudo-elements draw the connector lines
    // (vertical trunk between siblings, horizontal branch from parent).
    return (
      <div className="flex flex-row items-center">
        {chip}
        <div className="relative flex flex-col justify-center pl-6 before:absolute before:top-1/2 before:left-0 before:h-px before:w-6 before:bg-rule before:content-['']">
          {node.children.map((child, i) => {
            const only = node.children.length === 1;
            const first = i === 0;
            const last = i === node.children.length - 1;
            const barSide = only
              ? 'before:hidden'
              : first
                ? 'before:top-1/2 before:bottom-0'
                : last
                  ? 'before:top-0 before:bottom-1/2'
                  : 'before:top-0 before:bottom-0';
            return (
              <div
                key={i}
                className={`relative flex flex-row items-center py-1 pl-6 before:absolute before:left-0 before:w-px before:bg-rule before:content-[''] after:absolute after:top-1/2 after:left-0 after:h-px after:w-6 after:bg-rule after:content-[''] ${barSide}`}
              >
                <Node
                  node={child}
                  highlightNode={highlightNode}
                  nodeAnnotations={nodeAnnotations}
                  activeStack={activeStack}
                  doneNodes={doneNodes}
                  chipSize={chipSize}
                  orientation={orientation}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Vertical (default): chip centred on top, subcalls fan out in a row
  // below — same recipe RecursionTree uses.
  return (
    <div className="flex flex-col items-center">
      {chip}
      <div className="relative flex justify-center pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:w-px before:bg-rule before:content-['']">
        {node.children.map((child, i) => {
          const only = node.children.length === 1;
          const first = i === 0;
          const last = i === node.children.length - 1;
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
              className={`relative flex flex-col items-center px-1 pt-6 before:absolute before:top-0 before:h-px before:bg-rule before:content-[''] after:absolute after:top-0 after:left-1/2 after:h-6 after:w-px after:bg-rule after:content-[''] ${barSide}`}
            >
              <Node
                node={child}
                highlightNode={highlightNode}
                nodeAnnotations={nodeAnnotations}
                activeStack={activeStack}
                doneNodes={doneNodes}
                chipSize={chipSize}
                orientation={orientation}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChipProps {
  node: TreeNode;
  highlightNode?: string;
  nodeAnnotations?: Record<string, string>;
  activeStack?: string[];
  doneNodes?: string[];
  chipSize?: 'md' | 'sm';
}

/** Four visual states a chip can be in when a stepper drives the tree.
 * `static` = no stepper (activeStack/doneNodes not provided) — the chip
 * paints its natural affordance (base ⇒ keep, otherwise accent), same as
 * every non-mergesort/quicksort recipe. */
type ChipState = 'static' | 'pending' | 'onStack' | 'active' | 'done';

function Chip({
  node,
  highlightNode,
  nodeAnnotations,
  activeStack,
  doneNodes,
  chipSize = 'md',
}: ChipProps) {
  // Compact typography scale — `sm` is ~20 % tighter than `md`; used when
  // the tree stands alone in a slide where the default size overflows.
  const chipText = chipSize === 'sm' ? 'text-[10px]' : 'text-xs';
  const chipPad = chipSize === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1';
  // Track whether the caller is driving the tree with a running stepper.
  // When no stack/done set is provided, the chip renders its "static"
  // affordance (unchanged behaviour for max / binary-search / etc.).
  const stepperDriven = activeStack !== undefined || doneNodes !== undefined;
  const stackTop =
    activeStack && activeStack.length > 0 ? activeStack[activeStack.length - 1] : undefined;
  const onStack = activeStack?.includes(node.call) ?? false;
  const isDone = doneNodes?.includes(node.call) ?? false;
  const isActive = stackTop === node.call;

  const state: ChipState = stepperDriven
    ? isDone
      ? 'done'
      : isActive
        ? 'active'
        : onStack
          ? 'onStack'
          : 'pending'
    : 'static';

  // Fallback highlight for callers that pass `highlightNode` without a
  // stack (kept working for backwards compat and for the odd non-D&C
  // stepper that only knows the current call).
  const highlighted =
    state === 'active' || (highlightNode !== undefined && node.call === highlightNode);

  let affordance: string;
  if (state === 'static') {
    affordance = node.dimmed
      ? 'border-rule bg-sunk opacity-40'
      : node.isBase
        ? 'border-keep bg-keep-soft'
        : 'border-accent bg-accent-soft';
  } else if (state === 'done') {
    affordance = 'border-keep bg-keep-soft';
  } else if (state === 'active') {
    affordance = 'border-accent-pop bg-accent-soft';
  } else if (state === 'onStack') {
    affordance = 'border-accent bg-accent-soft/60';
  } else {
    // pending — recursion has not reached this call yet
    affordance = 'border-rule bg-sunk opacity-40';
  }
  const highlightRing = highlighted ? 'ring-2 ring-focus ring-offset-1 ring-offset-surface' : '';
  const annotation = nodeAnnotations?.[node.call];
  const middleSlots: { label: string; value: string }[] | undefined =
    annotation !== undefined
      ? [{ label: '', value: annotation }]
      : node.intermediates && node.intermediates.length > 0
        ? node.intermediates
        : undefined;

  // Only reveal the return value when the chip has actually returned.
  // In non-stepper mode (state === 'static') the return is always shown
  // — that is the natural affordance of the D/C tree widget on its own,
  // and every non-D&C recipe stays in that mode. In stepper mode a chip
  // shows its return value only in the `done` state (matches the runtime
  // semantics: a call has no return value until it actually returns).
  const showReturn = state === 'static' || state === 'done';

  return (
    <div
      data-call={node.call}
      data-return={node.returnValue}
      data-dimmed={node.dimmed ? 'true' : undefined}
      data-highlighted={highlighted ? 'true' : undefined}
      data-state={state}
      className={`inline-flex flex-col items-stretch overflow-hidden rounded border ${affordance} ${highlightRing} font-mono ${chipText} leading-tight whitespace-nowrap`}
    >
      <div className={`border-b border-rule/60 ${chipPad} text-ink`}>{node.call}</div>
      {/*
        Middle slot is ALWAYS rendered so the chip's height does not jump
        when a stepper toggles an annotation on / off across frames.
        `invisible` keeps it in the layout while hiding the placeholder;
        `aria-hidden` keeps it out of the reader.
      */}
      <div
        className={`flex gap-2 border-b border-rule/40 bg-sunk ${chipPad} text-ink-faint ${
          middleSlots ? '' : 'invisible'
        }`}
        aria-hidden={middleSlots ? undefined : true}
      >
        {middleSlots ? (
          middleSlots.map((it, i) => (
            <span key={`${it.label}-${i}`}>{it.label ? `${it.label}=${it.value}` : it.value}</span>
          ))
        ) : (
          <span>·</span>
        )}
      </div>
      <div className={`bg-surface ${chipPad} text-ink`}>
        {showReturn ? (
          node.dimmed ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <>
              <span className="mr-1 text-accent" aria-hidden>
                ↑
              </span>
              <strong>{node.returnValue}</strong>
            </>
          )
        ) : (
          // Placeholder so the chip's height stays the same across
          // frames (return-value slot always present, hidden until the
          // call actually returns).
          <span className="invisible" aria-hidden>
            ↑ …
          </span>
        )}
      </div>
    </div>
  );
}
