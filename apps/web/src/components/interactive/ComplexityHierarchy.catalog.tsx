import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazyComplexityHierarchy as ComplexityHierarchy } from './lazyComplexityHierarchy';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const complexityHierarchyCatalogEntry: CatalogEntry = {
  name: 'ComplexityHierarchy',
  family: 'interactive',
  description:
    'Visual encoding of `O(1) ⊂ O(lg N) ⊂ ··· ⊂ O(N!)` as stroked circles stacked top-aligned: the smallest circle sits at the top (O(1), the cheapest class), and each larger class shares the same upper edge so its "belly" hangs below the previous one — the visible crescent carries the label. Colour goes from green (top, cheap) to red (bottom, expensive) via an HSL hue sweep. A lateral list carries the notation, its Spanish name, and per-class examples; hovering a ring or a row highlights the same class in both.',
  whenToUse:
    'When teaching the asymptotic hierarchy — the mental model that a lower-class algorithm is always available (though not always available EFFICIENTLY) at any higher class. Best paired with a slide that also states the hierarchy in words; the widget makes the containment tangible. NOT for showing curves of specific functions — that is `<MathPlot>`. NOT for showing the growth rate of a specific algorithm — that is `<ComplexityCounter>`.',
  props: [
    {
      name: 'classes',
      type: 'ComplexityClass[]',
      description:
        'Classes in cheap-to-expensive order: the first is the topmost/smallest ring, the last is the bottommost/largest. Each item is `{ name: string; description?: string; examples: string[] }` — `name` is the notation shown in the ring (e.g. `"O(1)"`), `description` is the optional Spanish label shown alongside in the list (e.g. `"Constante"`), and `examples` are short strings that appear as bullets below each row. Defaults to the nine canonical classes of the course (O(1), O(lg N), O(√N), O(N), O(N lg N), O(N²), O(N³), O(2ᴺ), O(N!)).',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Optional heading rendered above the widget.',
    },
  ],
  examples: [
    {
      title: 'Default: nine canonical classes with descriptions and course examples',
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
