import type { ReactNode } from 'react';

import type { CatalogEntry } from '../../lib/catalogEntry';

// The wrapper, not the component. The entries are no longer eager (#122), so
// this no longer guards the ENTRY chunk — it guards the catalog's own: a static
// import here would pull the runtime and CodeMirror into the chunk /catalog
// fetches, for a page whose examples the reader may never scroll to. It is also
// what a document writes, which is what an example must render. Aliased for
// exactly that.
import { LazyPredictOutput as PredictOutput } from './lazyPredictOutput';

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

const ALIASING_TRAP = `class Demo {
    public static void main(String[] args) {
        String a = new String("hola");
        String b = new String("hola");
        System.out.println(a == b);
        System.out.println(a.equals(b));
    }
}
`;

const INTEGER_CACHE = `class Demo {
    public static void main(String[] args) {
        Integer a = 127;  Integer b = 127;
        Integer c = 128;  Integer d = 128;
        System.out.println(a == b);
        System.out.println(c == d);
    }
}
`;

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const predictOutputCatalogEntry: CatalogEntry = {
  name: 'PredictOutput',
  family: 'interactive',
  description:
    'A snippet the student predicts the output of before seeing it. The listing is read-only and runs through the same runtime seam <CodeEditor> uses, so the reveal is what the program actually printed — never an author-written answer that ships past a green build.',
  whenToUse:
    'When the point of a passage is that the reader is going to guess wrong. Traps like `new String("hola") == new String("hola")` and the Integer cache at 128 teach far more when the JVM is the one saying so than when the author asserts an answer in prose. Same hazard shape ADR-0019 §7 records for exercise fences — an authored answer that lies is invisible to every gate. ' +
    'Java only, and Java 8 like everything else here (`runtime/java/runtime.ts` pins the CheerpJ version). ' +
    'The same Java sharp edge CodeEditor carries applies to this component too (ADR-0017): a snippet that never terminates freezes the tab and no timeout recovers it. Keep the snippets terminating — this component exists for pinpoint programs, not for loops. Two of these on one page share one JVM and one queue with every other Java editor on the page — the footer says so while it waits. ' +
    'The three platform class names are reserved everywhere Java compiles here — `NalandaLauncher`, `NalandaCheck` and `NalandaTrace` (#123). A snippet declaring one at top level is refused before the JVM boots, not silently corrupted.',
  props: [
    {
      name: 'title',
      type: 'string',
      description: "Shown as the card's heading. Optional.",
    },
    {
      name: 'language',
      type: "'java' | 'cpp' | 'python'",
      default: "'java'",
      description:
        'Which runtime compiles and runs the snippet. Only Java is expected today; the other two are accepted by the seam but no shipped document uses them here.',
    },
    {
      name: 'children',
      type: 'MDX',
      description:
        'The statement as prose, plus one fence marked `predict` — ```java predict — carrying the snippet to run. Prose renders; the fence does not appear in the flow, it lands in the read-only listing so the same source cannot be shown twice.',
    },
  ],
  examples: [
    {
      title: 'The two-Strings trap',
      code: `<PredictOutput title="Dos veces \\"hola\\"">

¿Qué imprime este programa?

\`\`\`java predict
${ALIASING_TRAP}\`\`\`

</PredictOutput>`,
      render: () => (
        <PredictOutput title={'Dos veces "hola"'}>
          <p>¿Qué imprime este programa?</p>
          {fence('predict', ALIASING_TRAP)}
        </PredictOutput>
      ),
    },
    {
      title: 'The Integer cache at 128',
      code: `<PredictOutput title="127 y 128">

Un solo número los separa. ¿Cambia algo la respuesta?

\`\`\`java predict
${INTEGER_CACHE}\`\`\`

</PredictOutput>`,
      render: () => (
        <PredictOutput title="127 y 128">
          <p>Un solo número los separa. ¿Cambia algo la respuesta?</p>
          {fence('predict', INTEGER_CACHE)}
        </PredictOutput>
      ),
    },
    {
      title: 'No predict fence: the warning is for the author, not the student',
      code: `<PredictOutput title="Sin cerca">

Un ejemplo al que le falta la cerca marcada.

</PredictOutput>`,
      render: () => (
        <PredictOutput title="Sin cerca">
          <p>Un ejemplo al que le falta la cerca marcada.</p>
        </PredictOutput>
      ),
    },
  ],
};
