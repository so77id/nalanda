import type { ReactNode } from 'react';

import type { CatalogEntry } from '../../lib/catalogEntry';

// The wrapper, not the component: this entry is reachable from the shell's eager
// `catalogEntries`, so a static import would undo the lazy split and put the
// runtime in the entry chunk. Aliased because the examples render what a
// document writes.
import { LazyMemoryDiagram as MemoryDiagram } from './lazyMemoryDiagram';

/** What the MDX pipeline hands the component for an annotated fence. */
function fence(meta: string, code: string): ReactNode {
  return (
    <pre>
      <code className="language-java" data-meta={meta}>
        {code}
      </code>
    </pre>
  );
}

const ALIASING = `class Punto {
    int x, y;
    Punto(int x, int y) { this.x = x; this.y = y; }
}

public class Demo {
    public static void main(String[] args) {
        Punto a = new Punto(1, 2);   // foto a
        Punto b = a;                 // foto a, b
        b.x = 99;                    // foto a, b
    }
}
`;

const SWAP = `class Punto {
    int x, y;
    Punto(int x, int y) { this.x = x; this.y = y; }
}

public class Demo {
    static void intercambia(Punto p, Punto q) {
        Punto t = p;
        p = q;
        q = t;                       // foto intercambia: p, q
                                     // foto-fin intercambia
    }

    public static void main(String[] args) {
        Punto a = new Punto(1, 2);
        Punto b = new Punto(3, 4);   // foto a, b
        intercambia(a, b);           // foto a, b
    }
}
`;

/** Catalog entry (ADR-0010) — colocated with the component, exported via the seam. */
export const memoryDiagramCatalogEntry: CatalogEntry = {
  name: 'MemoryDiagram',
  family: 'interactive',
  description:
    'A drawing of variables, stack frames and heap objects, taken from the snippet beside it actually running in the reader’s browser. Values are never authored: a tracer class is compiled next to the program and photographs the named variables where the author marked them, so the picture cannot drift from the code.',
  whenToUse:
    'When the lesson IS the shape of memory rather than the output — aliasing, parameter passing, identity versus equality, and later linked lists and trees. Prose about references is nodded at and not understood; a drawing of two names on one box is not. ' +
    'Java only: the tracer uses Java reflection, and a diagram that silently drew nothing for C++ or Python would be worse than one that refuses. ' +
    'Nothing is fetched until the reader presses the button, so a page may carry several without any of them costing anything on load.',
  props: [
    {
      name: 'title',
      type: 'string',
      description: 'Heading shown in the diagram’s header. Optional.',
    },
    {
      name: 'children',
      type: 'MDX',
      description:
        'Prose, plus exactly one fence marked ```java trace```. Inside it, `// foto a, b` photographs those variables at that line; `// foto marco: p, q` opens a second frame and `// foto-fin marco` closes it. The markers are removed from what the reader sees, and every line keeps its number so the highlight lands on the right statement.',
    },
  ],
  examples: [
    {
      title: 'Dos variables, un objeto',
      code: `<MemoryDiagram title="Dos variables, un objeto">

\`\`\`java trace
${ALIASING}\`\`\`

</MemoryDiagram>`,
      render: () => (
        <MemoryDiagram title="Dos variables, un objeto">{fence('trace', ALIASING)}</MemoryDiagram>
      ),
    },
    {
      title: 'El intercambio que no funciona',
      code: `<MemoryDiagram title="El intercambio que no funciona">

\`\`\`java trace
${SWAP}\`\`\`

</MemoryDiagram>`,
      render: () => (
        <MemoryDiagram title="El intercambio que no funciona">{fence('trace', SWAP)}</MemoryDiagram>
      ),
    },
  ],
};
