import type { CatalogEntry } from '../../lib/catalogEntry';

// The wrapper, not the component. Same rule as lazyCodeEditor / lazyPredictOutput:
// this guards the catalog's own chunk — a static import here would pull the
// mermaid library (~200kB gzipped of mermaid-only chunks, measured — ADR-0040
// §Consequences) into the chunk
// /catalog fetches, for a page whose examples the reader may never scroll to.
// It is also what a document writes, which is what an example must render.
// Aliased for exactly that.
import { LazyMermaid as Mermaid } from './lazyMermaid';

/** The §7 diagram of "Objetos": two hierarchies, one dispatch. */
const POLIMORFISMO = `classDiagram
    class Vehiculo {
        +describir()
    }
    class Auto
    class Camion
    Vehiculo <|-- Auto
    Vehiculo <|-- Camion

    class Formal {
        +tratarDe()
    }
    <<interface>> Formal
    class Saludo
    class Despedida
    Formal <|.. Saludo
    Formal <|.. Despedida`;

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const mermaidCatalogEntry: CatalogEntry = {
  name: 'Mermaid',
  family: 'interactive',
  description:
    'A diagram a course document renders from a mermaid source string (ADR-0040). The author writes the source as a prop, the component loads the mermaid library on demand and paints the SVG — a class diagram today, and the same surface covers the sequence, state and entity-relationship diagrams the course will need before v0.3 closes.',
  whenToUse:
    'When the idea is a shape rather than a sentence: inheritance and interface hierarchies side by side, a state chart, an entity-relationship picture. Prose renders a diagram as a list; a diagram renders it as one picture with the parallel visible. ' +
    'NOT for a heap picture with named boxes and cross-frame aliasing — that is <MemoryVisual> inside a <StepShow> (#209, the ADR superseding 0028) — and NOT for recursion call trees, which <RecursionTree> draws natively. ' +
    "Keep the source small: the library parses and lays out on every mount, and the first mount also downloads the mermaid chunks (~200kB gzipped measured, ADR-0040 §Consequences). One diagram per section is the working budget today; a page that mounts many should trigger the ADR's revisit note.",
  props: [
    {
      name: 'source',
      type: 'string',
      description:
        'The diagram source, exactly as it would sit in a mermaid fence. Required; missing or blank renders an authoring error, not a broken figure.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Accessible label for the rendered figure. Optional; falls back to "diagrama".',
    },
  ],
  examples: [
    {
      title: 'The §7 diagram: polymorphism hangs off inheritance and interfaces alike',
      code: '<Mermaid title="Un mismo dispatch, dos jerarquías" source={`classDiagram ...`} />',
      render: () => <Mermaid title="Un mismo dispatch, dos jerarquías" source={POLIMORFISMO} />,
    },
    {
      title: 'No source: the error is for the author, not the student',
      code: '<Mermaid />',
      render: () => <Mermaid />,
    },
  ],
};
