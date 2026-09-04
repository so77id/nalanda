/**
 * Pure decision-tree builder for the comparison-based sorting lower bound
 * widget `<DecisionTreeSort>` (ADR-0066). Exported so the tests can pin the
 * shape without touching the DOM.
 *
 * We do NOT trace a specific algorithm (insertion, merge, quick — any of
 * them yields a valid tree; the bound applies to all comparison-based
 * sorts). Instead, at every node we pick the comparison that splits the
 * remaining permutations closest to 50/50 (the "balanced" tree). This gives
 * the tree the minimum possible height for the SAME N! leaves — which is
 * exactly the lower bound ⌈log₂(N!)⌉ the class is trying to argue.
 *
 * Permutation encoding: `perm[i] = rank of a[i]` (0 = smallest). So perm
 * `[1, 2, 0]` on names `[a, b, c]` means a is the 2nd smallest, b is the
 * largest, c is the smallest → sorted output "cab".
 */

export interface DecisionInternal {
  kind: 'internal';
  /** The two positions whose elements are compared here. */
  compare: [number, number];
  yes: DecisionNode;
  no: DecisionNode;
  /** Depth of this node from the root (root = 0). */
  depth: number;
}

export interface DecisionLeaf {
  kind: 'leaf';
  /** The single permutation that ends here. */
  perm: number[];
  /** Element names in sorted order — e.g. "cab" for perm [1,2,0]. */
  sorted: string;
  /** Depth from the root — also the number of comparisons made to reach it. */
  depth: number;
}

export type DecisionNode = DecisionInternal | DecisionLeaf;

/** Element names — 'a', 'b', 'c', ... — indexed by position in the input. */
export function elementNames(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));
}

/** Permutation `perm[i] = rank(a[i])` → sorted output string like "cab". */
export function permToSorted(perm: number[]): string {
  const n = perm.length;
  const result = new Array<string>(n);
  for (let i = 0; i < n; i += 1) result[perm[i]!] = String.fromCharCode(97 + i);
  return result.join('');
}

/** All N! permutations of [0..N-1], in lexicographic order. */
export function allPermutations(n: number): number[][] {
  if (n === 0) return [[]];
  const smaller = allPermutations(n - 1);
  const out: number[][] = [];
  for (const p of smaller) {
    for (let i = 0; i <= p.length; i += 1) {
      const copy = [...p];
      copy.splice(i, 0, n - 1);
      out.push(copy);
    }
  }
  return out;
}

/** ⌈log₂(N!)⌉ — the information-theoretic lower bound on comparisons. */
export function log2FactorialCeil(n: number): number {
  let logSum = 0;
  for (let k = 2; k <= n; k += 1) logSum += Math.log2(k);
  return Math.ceil(logSum);
}

/** Factorial of a small `n`. */
export function factorial(n: number): number {
  let r = 1;
  for (let k = 2; k <= n; k += 1) r *= k;
  return r;
}

/** Build the balanced-split decision tree for sorting N distinct elements. */
export function buildDecisionTree(n: number): DecisionNode {
  const perms = allPermutations(n);
  return build(perms, new Set<string>(), 0);
}

function build(perms: number[][], decided: Set<string>, depth: number): DecisionNode {
  if (perms.length <= 1) {
    return {
      kind: 'leaf',
      perm: perms[0]!,
      sorted: permToSorted(perms[0]!),
      depth,
    };
  }
  const n = perms[0]!.length;
  let bestSplit: { i: number; j: number; yes: number[][]; no: number[][]; balance: number } | null =
    null;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const key = `${i},${j}`;
      if (decided.has(key)) continue;
      const yes = perms.filter((p) => p[i]! < p[j]!);
      const no = perms.filter((p) => p[i]! > p[j]!);
      if (yes.length === 0 || no.length === 0) continue;
      const balance = Math.abs(yes.length - no.length);
      if (
        bestSplit === null ||
        balance < bestSplit.balance ||
        // Tie-break by preferring the lex-earliest (i,j) — deterministic across runs.
        (balance === bestSplit.balance &&
          (i < bestSplit.i || (i === bestSplit.i && j < bestSplit.j)))
      ) {
        bestSplit = { i, j, yes, no, balance };
      }
    }
  }
  if (bestSplit === null) {
    // Shouldn't happen when perms > 1, but return a collapsed leaf if it does.
    return {
      kind: 'leaf',
      perm: perms[0]!,
      sorted: permToSorted(perms[0]!),
      depth,
    };
  }
  const newDecided = new Set([...decided, `${bestSplit.i},${bestSplit.j}`]);
  return {
    kind: 'internal',
    compare: [bestSplit.i, bestSplit.j],
    yes: build(bestSplit.yes, newDecided, depth + 1),
    no: build(bestSplit.no, newDecided, depth + 1),
    depth,
  };
}

/** Height (longest root-to-leaf path length) of the tree. */
export function treeHeight(node: DecisionNode): number {
  if (node.kind === 'leaf') return node.depth;
  return Math.max(treeHeight(node.yes), treeHeight(node.no));
}

/** Number of leaves in the tree. Should always equal N!. */
export function leafCount(node: DecisionNode): number {
  if (node.kind === 'leaf') return 1;
  return leafCount(node.yes) + leafCount(node.no);
}

/** The `sorted` label of the deepest leaf — used by "Mostrar peor caso". */
export function worstCaseLeaf(node: DecisionNode): DecisionLeaf {
  if (node.kind === 'leaf') return node;
  const y = worstCaseLeaf(node.yes);
  const nn = worstCaseLeaf(node.no);
  return y.depth >= nn.depth ? y : nn;
}
