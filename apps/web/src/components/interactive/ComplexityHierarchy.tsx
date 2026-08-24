import { useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { useResolvedTheme } from '../../lib/useResolvedTheme';

/**
 * One row in the hierarchy: an asymptotic class and the algorithms whose cost
 * belongs to it (canonical examples the student should recognise on sight).
 */
export interface ComplexityClass {
  /** Notation of the class, e.g. `"O(1)"`, `"O(N lg N)"`, `"O(2ᴺ)"`. */
  name: string;
  /** Short natural-language descriptions of algorithms in this class. */
  examples: string[];
}

export interface ComplexityHierarchyProps {
  /**
   * Classes in "cheap-to-expensive" order — the first class is the innermost
   * ring (best), the last is the outermost (worst). Defaults to the seven
   * canonical classes covered in the current course.
   */
  classes?: ComplexityClass[];
  /** Optional heading rendered above the widget. */
  title?: string;
}

/** The seven classes named in the course's textual hierarchy. */
const DEFAULT_CLASSES: ComplexityClass[] = [
  {
    name: 'O(1)',
    examples: ['acceso a array', 'suma con fórmula cerrada', 'aritmética básica'],
  },
  {
    name: 'O(lg N)',
    examples: ['búsqueda binaria', 'operaciones en árbol balanceado'],
  },
  {
    name: 'O(N)',
    examples: ['recorrido lineal', 'findInArray peor caso', 'sumaCiclo'],
  },
  {
    name: 'O(N lg N)',
    examples: ['mergesort', 'quicksort promedio', 'ordenamientos óptimos por comparación'],
  },
  {
    name: 'O(N²)',
    examples: ['bubble sort', 'insertion sort', 'sumaDobleCiclo'],
  },
  {
    name: 'O(N³)',
    examples: ['multiplicación de matrices ingenua', 'Floyd-Warshall'],
  },
  {
    name: 'O(2ᴺ)',
    examples: ['fuerza bruta sobre subconjuntos', 'TSP naïve', 'Fibonacci recursivo'],
  },
];

/**
 * Visual encoding of `O(1) ⊂ O(lg N) ⊂ ··· ⊂ O(2ᴺ)` as concentric
 * rounded rectangles. The innermost box is the cheapest class; each outer
 * ring adds one class, so the "contains" relation reads visually as
 * containment. Colour goes from green (inner, cheap) to red (outer,
 * expensive) via an HSL hue sweep — the same lesson the class transmits in
 * words: closer to the centre is better.
 *
 * Interactivity: hovering a ring (in the SVG) or a row (in the lateral
 * list) highlights the same class in both — the two views are kept in sync
 * by a single `activeIdx` state. The list carries per-class examples;
 * hovering surfaces which ring holds which algorithm.
 */
export function ComplexityHierarchy({
  classes = DEFAULT_CLASSES,
  title,
}: ComplexityHierarchyProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const theme = useResolvedTheme();

  if (classes.length === 0) {
    return (
      <AuthoringError component="ComplexityHierarchy">
        <code>classes</code> no puede estar vacío: se necesita al menos una clase.
      </AuthoringError>
    );
  }

  const n = classes.length;
  // Dark themes need a lighter, less-saturated colour so the ring reads on a
  // dark background; light themes need a deeper colour so it reads on light.
  // Same hue sweep in both — the semantic mapping (green→red) is the
  // lesson, not the exact swatch.
  const lightness = theme === 'dark' ? 62 : 42;
  const saturation = theme === 'dark' ? 55 : 68;
  const strokeFor = (originalIdx: number) => {
    // Innermost class (index 0 → O(1)) is green (hue 120). Outermost
    // (index n-1 → O(2^N)) is red (hue 0).
    const hue = ((n - 1 - originalIdx) / (n - 1)) * 120;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  // Geometry — Venn-style concentric ellipses (VERTICAL — taller than wide).
  // Every ring keeps the same "half-height". The innermost ellipse holds
  // the smallest class's label along its top edge.
  const VIEWBOX_W = 320;
  const VIEWBOX_H = 480;
  const CX = VIEWBOX_W / 2;
  const CY = VIEWBOX_H / 2;
  const OUTER_MARGIN_X = 8;
  const OUTER_MARGIN_Y = 12;
  const INNER_RX = 22;
  const INNER_RY = 40;
  const STEP_X = (VIEWBOX_W / 2 - OUTER_MARGIN_X - INNER_RX) / (n - 1 || 1);
  const STEP_Y = (VIEWBOX_H / 2 - OUTER_MARGIN_Y - INNER_RY) / (n - 1 || 1);

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      {title !== undefined && (
        <header className="border-b border-rule bg-sunk px-3 py-1.5 text-sm text-ink">
          {title}
        </header>
      )}
      <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr]">
        <div className="min-w-0 border-b border-rule p-4 md:border-b-0 md:border-r">
          <svg
            viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
            className="mx-auto block h-auto w-full max-w-lg"
            role="img"
            aria-label="Jerarquía de clases asintóticas — elipses concéntricas al estilo Venn, la clase más eficiente al centro"
          >
            {classes.map((cls, i) => {
              // `classes` is authored cheap-to-expensive (O(1) first,
              // O(2ᴺ) last). The Venn semantic is A ⊂ B → A drawn INSIDE
              // B: O(1) is the smallest set (few algorithms are constant),
              // O(2ᴺ) is the largest (contains every polynomial and log
              // class), so the earliest class in the array is the
              // innermost ring. rx/ry grow linearly with index.
              const ringDepth = i;
              const rx = INNER_RX + ringDepth * STEP_X;
              const ry = INNER_RY + ringDepth * STEP_Y;
              const isActive = activeIdx === i;
              const stroke = strokeFor(i);
              // Label sits just below the top edge of its ellipse, centred
              // horizontally — same "top-hanging" convention every Venn
              // sketch uses.
              const labelY = CY - ry + 14;
              return (
                <g key={cls.name}>
                  <ellipse
                    cx={CX}
                    cy={CY}
                    rx={rx}
                    ry={ry}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isActive ? 5 : 2.5}
                    style={{ transition: 'stroke-width 120ms ease' }}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseLeave={() => setActiveIdx(null)}
                    className="cursor-pointer"
                  />
                  <text
                    x={CX}
                    y={labelY}
                    fill={stroke}
                    fontSize={13}
                    fontFamily="monospace"
                    fontWeight={isActive ? 700 : 500}
                    textAnchor="middle"
                    style={{ pointerEvents: 'none' }}
                  >
                    {cls.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <ul
          role="list"
          aria-label="Ejemplos de algoritmos por clase asintótica"
          className="flex flex-col divide-y divide-rule/50"
        >
          {classes.map((cls, i) => {
            const stroke = strokeFor(i);
            const isActive = activeIdx === i;
            return (
              <li
                key={cls.name}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
                className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-accent-soft/40' : 'hover:bg-accent-soft/20'
                }`}
                data-active={isActive}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: stroke }}
                    aria-hidden="true"
                  />
                  <code className="font-mono text-sm text-ink">{cls.name}</code>
                </div>
                <ul className="mt-1 flex flex-col gap-y-0.5 pl-5 text-xs text-ink-soft">
                  {cls.examples.map((ex) => (
                    <li key={ex}>· {ex}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
