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
    examples: ['fuerza bruta sobre subconjuntos', 'Fibonacci recursivo'],
  },
  {
    name: 'O(N!)',
    examples: ['fuerza bruta sobre permutaciones', 'TSP naïve'],
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
  // Two derivations of the class hue: one for the stroke (deep, readable
  // against the surface background) and one for the label text (same hue,
  // slightly deeper still — it sits inside the ring, so it needs to
  // separate from the stroke line without competing with it).
  const strokeLightness = theme === 'dark' ? 60 : 42;
  const strokeSaturation = theme === 'dark' ? 60 : 68;
  const strokeFor = (originalIdx: number) => {
    // Innermost / topmost class (index 0 → O(1)) is green (hue 120).
    // Outermost / bottommost (index n-1 → O(2ᴺ)) is red (hue 0).
    const hue = ((n - 1 - originalIdx) / (n - 1)) * 120;
    return `hsl(${hue}, ${strokeSaturation}%, ${strokeLightness}%)`;
  };

  // Geometry — filled circles stacked top-aligned.
  //   - r_i grows linearly: r_i = R_MIN + i · STEP.
  //   - All circles share the same top edge at y = TOP_MARGIN.
  //   - Consequently cy_i = TOP_MARGIN + r_i, and the visible crescent
  //     of circle i (uncovered by circle i-1) spans y ∈ [top+2·r_{i-1},
  //     top+2·r_i], of height STEP·2 — enough for one line of label at
  //     the crescent's midpoint.
  const R_MIN = 28;
  const STEP = 26;
  const TOP_MARGIN = 14;
  const SIDE_MARGIN = 14;
  const r = (i: number) => R_MIN + i * STEP;
  const R_MAX = r(n - 1);
  const VIEWBOX_W = 2 * R_MAX + 2 * SIDE_MARGIN;
  const VIEWBOX_H = 2 * R_MAX + 2 * TOP_MARGIN;
  const CX = VIEWBOX_W / 2;
  const cy = (i: number) => TOP_MARGIN + r(i);
  // Label y positioning:
  // - i = 0: centred vertically in the topmost circle. `+4` compensates
  //   the text baseline so the glyph appears vertically centred.
  // - i > 0: centred in the visible crescent (band between circle i-1's
  //   bottom edge and circle i's bottom edge). Crescent spans y ∈
  //   [top + 2·r_{i-1}, top + 2·r_i], midpoint = top + r_{i-1} + r_i.
  //   With STEP fixed, the crescent height is 2·STEP — enough for a
  //   13px label with padding on both strokes.
  const labelY = (i: number) =>
    i === 0 ? cy(0) + 4 : TOP_MARGIN + r(i - 1) + r(i) + 4;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      {title !== undefined && (
        <header className="border-b border-rule bg-sunk px-3 py-1.5 text-sm text-ink">
          {title}
        </header>
      )}
      <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 items-center justify-center border-b border-rule p-4 md:border-b-0 md:border-r">
          <svg
            viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
            className="mx-auto block h-auto w-full max-w-sm"
            role="img"
            aria-label="Jerarquía de clases asintóticas — círculos apilados alineados por el borde superior, la clase más eficiente arriba"
          >
            {/* Stroke-only rings (no fill). Drawn largest-first so the
                smaller ones sit visually on top. */}
            {[...classes]
              .map((cls, i) => ({ cls, i }))
              .reverse()
              .map(({ cls, i }) => {
                const stroke = strokeFor(i);
                const isActive = activeIdx === i;
                return (
                  <circle
                    key={cls.name}
                    cx={CX}
                    cy={cy(i)}
                    r={r(i)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isActive ? 5 : 2.5}
                    // pointerEvents:'all' lets the whole disc capture
                    // hover — no need to aim at the stroke. Because
                    // circles are drawn largest-first (small ones on
                    // top of DOM), the browser resolves the topmost
                    // circle under the cursor first, so hovering the
                    // O(1) area picks O(1), and hovering the crescent
                    // between O(N) and O(N lg N) picks O(N lg N)
                    // naturally.
                    style={{ pointerEvents: 'all', transition: 'stroke-width 120ms ease' }}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseLeave={() => setActiveIdx(null)}
                    className="cursor-pointer"
                  />
                );
              })}
            {/* Labels drawn on a separate pass, in the same colour as
                each class's stroke so the pairing reads. */}
            {classes.map((cls, i) => (
              <text
                key={`label-${cls.name}`}
                x={CX}
                y={labelY(i)}
                fill={strokeFor(i)}
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
            const fill = strokeFor(i);
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
