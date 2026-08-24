import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyComplexityHierarchy as ComplexityHierarchy } from './lazyComplexityHierarchy';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const complexityHierarchyCatalogEntry: CatalogEntry = {
  name: 'ComplexityHierarchy',
  family: 'interactive',
  description:
    'Visual encoding of `O(1) ⊂ O(lg N) ⊂ ··· ⊂ O(2ᴺ)` as concentric rounded rectangles: the innermost box is the cheapest class, each outer ring adds one class, so the mathematical containment reads visually as physical containment. Colour goes from green (inner, cheap) to red (outer, expensive) via an HSL hue sweep — the same lesson the class transmits in words. A lateral list carries per-class examples; hovering a ring or a row highlights the same class in both.',
  whenToUse:
    'When teaching the asymptotic hierarchy — the mental model that a lower-class algorithm is always available (though not always available EFFICIENTLY) at any higher class. Best paired with a slide that also states the hierarchy in words; the widget makes the containment tangible. NOT for showing curves of specific functions — that is `<MathPlot>`. NOT for showing the growth rate of a specific algorithm — that is `<ComplexityCounter>`.',
  props: [
    {
      name: 'classes',
      type: 'ComplexityClass[]',
      description:
        'Classes in cheap-to-expensive order: the first is the innermost ring, the last is the outermost. Each item is `{ name: string; examples: string[] }`. Defaults to the seven canonical classes covered in the course (O(1), O(lg N), O(N), O(N lg N), O(N²), O(N³), O(2ᴺ)).',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional heading rendered above the widget.',
    },
  ],
  examples: [
    {
      title: 'Default: seven canonical classes with course-relevant examples',
      code: '<ComplexityHierarchy title="Jerarquía asintótica" />',
      render: () => <ComplexityHierarchy title="Jerarquía asintótica" />,
    },
    {
      title: 'Custom classes — recursion focus (Peli 2)',
      code: '<ComplexityHierarchy classes={[{name: "Θ(1)", examples: [...]}, ...]} />',
      render: () => (
        <ComplexityHierarchy
          title="Recurrencias comunes"
          classes={[
            { name: 'Θ(1)', examples: ['tail call trivial'] },
            { name: 'Θ(lg N)', examples: ['búsqueda binaria recursiva'] },
            { name: 'Θ(N)', examples: ['recorrido de lista recursivo'] },
            { name: 'Θ(N lg N)', examples: ['mergesort'] },
            { name: 'Θ(2ᴺ)', examples: ['Fibonacci naïve', 'permutaciones'] },
          ]}
        />
      ),
    },
    {
      title: 'Empty classes — the error is for the author',
      code: '<ComplexityHierarchy classes={[]} />',
      render: () => <ComplexityHierarchy classes={[]} />,
    },
  ],
};
