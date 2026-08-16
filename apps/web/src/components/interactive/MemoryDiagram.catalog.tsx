import type { ReactNode } from 'react';

import type { CatalogEntry } from '../../lib/catalogEntry';

// The wrapper, not the component. The entries are no longer eager (#122), so
// this no longer guards the ENTRY chunk — it guards the catalog's own: a static
// import here would pull the runtime into the chunk /catalog fetches, for a page whose
// examples the reader may never scroll to. It is also what a document writes,
// which is what an example must render. Aliased for exactly that.
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

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const memoryDiagramCatalogEntry: CatalogEntry = {
  name: 'MemoryDiagram',
  family: 'interactive',
  description:
    'A drawing of variables, stack frames and heap objects, taken from the snippet beside it actually running in the reader’s browser. Values are never authored: a tracer class is compiled next to the program and photographs the named variables where the author marked them, so the picture cannot drift from the code.',
  whenToUse:
    'When the lesson IS the shape of memory rather than the output — aliasing, parameter passing, identity versus equality, and later linked lists and trees. Prose about references is nodded at and not understood; a drawing of two names on one box is not. ' +
    'Java only, and Java 8: the tracer uses Java reflection, and a diagram that silently drew nothing for C++ or Python would be worse than one that refuses. ' +
    'NOT for recursion — frames are identified by the name in the marker, so nested calls to one method collapse into a single frame showing the innermost values. That is the one case where this component can teach the opposite of the truth; the call stack needs a different component (Discussion #49). ' +
    'Bounded at 40 photographs, 12 objects drawn and 32 elements or fields per box; past any of those the diagram says so rather than presenting a partial trace as complete. ' +
    'The compiler is fetched only when the reader presses the button, but mounting already costs ~120 kB gzip of Java runtime module and CodeMirror grammar this component never uses (measured; #122), so do not put many on one page yet.',
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
