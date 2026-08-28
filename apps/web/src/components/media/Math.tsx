import { Suspense, lazy } from 'react';

// Runtime KaTeX renderer, lazy-loaded — katex is ~260 kB before gzip
// and must NOT ride in the entry chunk of every page. Guarded by
// `src/architecture.test.ts`.
const KatexInline = lazy(() => import('../../lib/katexInline'));

export interface MathProps {
  /** The LaTeX source, as a plain string. */
  children: string;
  /**
   * When true, render as display math (centered, own block) instead of
   * inline. Same distinction KaTeX's `displayMode` makes. Default false.
   */
  block?: boolean;
}

/**
 * A math formula rendered by KaTeX at runtime.
 *
 * Authors of prose use `$...$` and `$$...$$` in MDX (rehype-katex
 * handles those at build time). This component exists for the OTHER
 * path — inside JSX expression attributes like
 * `<ComplexityExercise reveal={...}>`, where the reveal is a JSX
 * expression and rehype-katex never gets to run on the string. The
 * author writes `<Math block>{'T(N) = T(N-1) + c'}</Math>` and the
 * formula lands as real KaTeX-rendered math.
 *
 * The lazy boundary is inherited from `katexInline`: neither KaTeX
 * itself nor its font metadata enters the entry chunk, and pages
 * without a `<Math>` never download it.
 */
export function Math({ children, block = false }: MathProps) {
  const fallback = <code className="font-mono text-xs">{children}</code>;
  return (
    <Suspense fallback={fallback}>
      <KatexInline math={children} block={block} />
    </Suspense>
  );
}
