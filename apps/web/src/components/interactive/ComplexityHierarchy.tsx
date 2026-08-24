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
   * Classes in "cheap-to-expensive" order — the first class is the
   * innermost / topmost circle (smallest set: O(1) — few algorithms
   * are constant); the last is the outermost / bottommost circle
   * (largest set: O(2ᴺ) — contains every polynomial and log class).
   * Defaults to the seven canonical classes covered in the current
   * course.
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
 * Visual encoding of `O(1) ⊂ O(lg N) ⊂ ··· ⊂ O(2ᴺ)` as filled circles
 * stacked top-aligned: the smallest set (O(1)) sits at the top as the
 * smallest circle; each larger class is a bigger circle sharing the same
 * upper edge, so its "belly" hangs below the previous one. That belly —
 * the visible crescent — carries the class's label. Colour goes from
 * green (top, cheap) to red (bottom, expensive) via an HSL hue sweep.
 *
 * Interactivity: hovering a circle (in the SVG) or a row (in the lateral
 * list) highlights the same class in both — the two views are kept in
 * sync by a single `activeIdx` state. The list carries per-class
 * examples so the reader can pair each ring with concrete algorithms.
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
  // Dark themes need a lighter, less-saturated fill so the crescent reads on
  // a dark background; light themes need a deeper one. Same hue sweep in
  // both — the semantic mapping (green→red) is the lesson, not the exact
  // swatch.
  const lightness = theme === 'dark' ? 55 : 48;
  const saturation = theme === 'dark' ? 55 : 62;
  const fillFor = (originalIdx: number) => {
    // Innermost / topmost class (index 0 → O(1)) is green (hue 120).
    // Outermost / bottommost (index n-1 → O(2ᴺ)) is red (hue 0).
    const hue = ((n - 1 - originalIdx) / (n - 1)) * 120;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };

  // Geometry — filled circles stacked top-aligned.
  //   - r_i grows linearly: r_i = R_MIN + i · STEP.
  //   - All circles share the same top edge at y = TOP_MARGIN.
  //   - Consequently cy_i = TOP_MARGIN + r_i, and the visible crescent
  //     of circle i (uncovered by circle i-1) spans y ∈ [top+2·r_{i-1},
  //     top+2·r_i], of height STEP·2 — enough for one line of label at
  //     the crescent's midpoint.
  const R_MIN = 26;
  const STEP = 22;
  const TOP_MARGIN = 12;
  const SIDE_MARGIN = 12;
  const r = (i: number) => R_MIN + i * STEP;
  const R_MAX = r(n - 1);
  const VIEWBOX_W = 2 * R_MAX + 2 * SIDE_MARGIN;
  const VIEWBOX_H = 2 * R_MAX + 2 * TOP_MARGIN;
  const CX = VIEWBOX_W / 2;
  const cy = (i: number) => TOP_MARGIN + r(i);
  // Label y: for i=0 the label sits at the centre of the top circle.
  // For i>0 it sits at the midpoint of the visible crescent below
  // circle i-1.
  const labelY = (i: number) => (i === 0 ? cy(0) + 4 : TOP_MARGIN + r(i - 1) + r(i) - r(i - 1) / 2);

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
            className="mx-auto block h-auto w-full max-w-sm"
            role="img"
            aria-label="Jerarquía de clases asintóticas — círculos apilados alineados por el borde superior, la clase más eficiente arriba"
          >
            {/* Circles from largest (bottom, drawn first) to smallest (top,
                drawn last) so the small ones sit visually on top. */}
            {[...classes]
              .map((cls, i) => ({ cls, i }))
              .reverse()
              .map(({ cls, i }) => {
                const isActive = activeIdx === i;
                return (
                  <circle
                    key={cls.name}
                    cx={CX}
                    cy={cy(i)}
                    r={r(i)}
                    fill={fillFor(i)}
                    stroke={isActive ? fillFor(i) : 'none'}
                    strokeWidth={isActive ? 4 : 0}
                    style={{
                      transition: 'stroke-width 120ms ease, filter 120ms ease',
                      filter: isActive ? 'brightness(1.08)' : 'none',
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseLeave={() => setActiveIdx(null)}
                    className="cursor-pointer"
                  />
                );
              })}
            {/* Labels drawn on a separate pass so no circle covers a
                label below it. */}
            {classes.map((cls, i) => (
              <text
                key={`label-${cls.name}`}
                x={CX}
                y={labelY(i)}
                fill="white"
                fontSize={13}
                fontFamily="monospace"
                fontWeight={activeIdx === i ? 700 : 500}
                textAnchor="middle"
                style={{ pointerEvents: 'none' }}
              >
                {cls.name}
              </text>
            ))}
          </svg>
        </div>
        <ul
          role="list"
          aria-label="Ejemplos de algoritmos por clase asintótica"
          className="flex flex-col divide-y divide-rule/50"
        >
          {classes.map((cls, i) => {
            const fill = fillFor(i);
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
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: fill }}
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
