import { useMemo, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import {
  buildDecisionTree,
  elementNames,
  factorial,
  log2FactorialCeil,
  treeHeight,
  worstCaseLeaf,
  type DecisionNode,
} from './decisionTreeSortLogic';

export interface DecisionTreeSortProps {
  /** How many elements to sort — the tree has N! leaves. */
  n?: 2 | 3 | 4;
  /** Show the "log₂(N!) ≈ N log N" data panel. Default true. */
  showBound?: boolean;
  /** Header override. */
  title?: string;
}

/**
 * `<DecisionTreeSort>` — visualise the log₂(N!) lower bound for
 * comparison-based sorting (ADR-0066). Each internal node compares two
 * positions of the input; each leaf carries a possible sorted output. The
 * tree is the balanced one (splits perms 50/50 at each node) so its height
 * equals ⌈log₂(N!)⌉ — the tight lower bound the class is arguing.
 */
export function DecisionTreeSort({ n, showBound = true, title }: DecisionTreeSortProps) {
  const [worstCaseVisible, setWorstCaseVisible] = useState(false);

  if (n === undefined || (n !== 2 && n !== 3 && n !== 4)) {
    return (
      <AuthoringError component="DecisionTreeSort">
        la prop <code>n</code> tiene que ser 2, 3 o 4 (recibí <code>{String(n)}</code>). Con más
        elementos el árbol crece factorialmente y se vuelve ilegible en una diapositiva.
      </AuthoringError>
    );
  }

  const tree = useMemo(() => buildDecisionTree(n), [n]);
  const height = treeHeight(tree);
  const nFactorial = factorial(n);
  const bound = log2FactorialCeil(n);
  const worst = useMemo(() => worstCaseLeaf(tree), [tree]);
  const names = elementNames(n);

  // Path from root to worst-case leaf, as a set of node IDs (indexes in a
  // DFS numbering) — small enough for a Set lookup during render.
  const worstCasePath = useMemo(() => pathToLeaf(tree, worst.sorted), [tree, worst.sorted]);

  const heading = title ?? `Árbol de decisión · ordenamiento por comparación · n = ${n}`;

  return (
    <figure
      data-widget="decision-tree-sort"
      data-n={n}
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          cota
        </span>
        <h4 className="m-0 text-sm font-medium text-ink">{heading}</h4>
      </header>

      <div className="flex flex-col gap-4 px-3 py-4 lg:flex-row lg:items-start">
        <div className="lg:flex-1 lg:min-w-0 overflow-x-auto">
          <div className="flex justify-center">
            <Node
              node={tree}
              names={names}
              worstCasePath={worstCaseVisible ? worstCasePath : null}
              pathSoFar=""
            />
          </div>
        </div>
        {showBound ? (
          <aside className="lg:w-64 lg:shrink-0 flex flex-col gap-2 rounded border border-rule bg-sunk px-3 py-2 font-mono text-xs text-ink">
            <div className="flex justify-between gap-2">
              <span className="text-ink-faint">hojas</span>
              <span data-panel="leaves">
                <strong>{nFactorial}</strong> = {n}!
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-ink-faint">altura</span>
              <span data-panel="height">
                <strong>{height}</strong>
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-ink-faint">cota inf.</span>
              <span data-panel="bound">
                ⌈log₂({n}!)⌉ = <strong>{bound}</strong>
              </span>
            </div>
            <p className="m-0 border-t border-rule pt-2 text-3xs text-ink-faint">
              Cualquier árbol binario con {n}! hojas tiene altura ≥ ⌈log₂({n}!)⌉. Por Stirling,
              ⌈log₂(N!)⌉ ≈ N log N — la <strong>cota inferior</strong> de cualquier ordenamiento por
              comparación.
            </p>
          </aside>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-1.5">
        <button
          type="button"
          onClick={() => setWorstCaseVisible((v) => !v)}
          aria-pressed={worstCaseVisible}
          className="inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-pressed:bg-accent-soft aria-pressed:text-accent"
        >
          {worstCaseVisible ? 'Ocultar peor caso' : 'Mostrar peor caso'}
        </button>
        {worstCaseVisible ? (
          <span className="font-mono text-xs text-ink-faint">
            Peor caso: {worst.depth} comparaciones para llegar a{' '}
            <strong className="text-ink">[{worst.sorted.split('').join(',')}]</strong>.
          </span>
        ) : null}
      </div>
    </figure>
  );
}

// ── Tree rendering ───────────────────────────────────────────────────────

interface NodeProps {
  node: DecisionNode;
  names: string[];
  /** When set, chips on this path get a focus ring. */
  worstCasePath: string | null;
  /** The path of yes/no decisions to reach this node (e.g. "YNY"). */
  pathSoFar: string;
}

function Node({ node, names, worstCasePath, pathSoFar }: NodeProps) {
  const onWorstPath =
    worstCasePath !== null && worstCasePath.startsWith(pathSoFar) && worstCasePath !== pathSoFar;
  const isWorstLeaf = worstCasePath !== null && worstCasePath === pathSoFar;

  if (node.kind === 'leaf') {
    return (
      <div className="flex flex-col items-center">
        <Leaf leaf={node} highlighted={isWorstLeaf} />
      </div>
    );
  }

  const [i, j] = node.compare;
  return (
    <div className="flex flex-col items-center">
      <Internal
        left={names[i]!}
        right={names[j]!}
        depth={node.depth}
        highlighted={onWorstPath || isWorstLeaf}
      />
      <div className="relative flex justify-center gap-2 pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:w-px before:bg-rule before:content-['']">
        <BranchLabel label="sí" />
        <BranchLabel label="no" />
      </div>
      <div className="flex gap-4 pt-1">
        <Node
          node={node.yes}
          names={names}
          worstCasePath={worstCasePath}
          pathSoFar={`${pathSoFar}Y`}
        />
        <Node
          node={node.no}
          names={names}
          worstCasePath={worstCasePath}
          pathSoFar={`${pathSoFar}N`}
        />
      </div>
    </div>
  );
}

function Internal({
  left,
  right,
  depth,
  highlighted,
}: {
  left: string;
  right: string;
  depth: number;
  highlighted: boolean;
}) {
  return (
    <div
      data-decision-node="internal"
      data-depth={depth}
      data-highlighted={highlighted ? 'true' : undefined}
      className={`inline-flex items-center rounded border px-2 py-1 font-mono text-xs whitespace-nowrap ${
        highlighted
          ? 'border-accent-pop bg-accent-soft text-ink ring-2 ring-focus ring-offset-1 ring-offset-surface'
          : 'border-accent bg-surface text-ink'
      }`}
    >
      {left} &lt; {right} ?
    </div>
  );
}

function Leaf({
  leaf,
  highlighted,
}: {
  leaf: { sorted: string; depth: number };
  highlighted: boolean;
}) {
  return (
    <div
      data-decision-node="leaf"
      data-sorted={leaf.sorted}
      data-depth={leaf.depth}
      data-highlighted={highlighted ? 'true' : undefined}
      title={`${leaf.depth} comparaciones`}
      className={`inline-flex flex-col items-center rounded border px-2 py-1 font-mono text-xs ${
        highlighted
          ? 'border-keep bg-keep-soft text-ink ring-2 ring-focus ring-offset-1 ring-offset-surface'
          : 'border-keep bg-keep-soft text-ink'
      }`}
    >
      <span>[{leaf.sorted.split('').join(',')}]</span>
      <span className="text-3xs text-ink-faint">{leaf.depth} cmp</span>
    </div>
  );
}

function BranchLabel({ label }: { label: string }) {
  return <span className="font-mono text-3xs tracking-wide text-ink-faint uppercase">{label}</span>;
}

// ── Path helper ──────────────────────────────────────────────────────────

/** Return the yes/no decision string ("YNYN...") from root to the leaf whose
 * `sorted` matches. Deterministic when leaves are unique. */
function pathToLeaf(node: DecisionNode, target: string): string {
  function walk(n: DecisionNode, path: string): string | null {
    if (n.kind === 'leaf') return n.sorted === target ? path : null;
    return walk(n.yes, `${path}Y`) ?? walk(n.no, `${path}N`);
  }
  return walk(node, '') ?? '';
}
