import type { CatalogEntry } from '../../lib/catalogEntry';

// The lazy wrapper, not the widget itself: it carries its own Suspense boundary
// so live examples render without one, and it keeps the catalog page's chunk
// off the CodeMirror hazard the widget imports. Aliased as `StepShow` because
// that is what a document writes, and an example must render what the
// document writes.
import { LazyStepShow as StepShow } from './lazyStepShow';
import { Step } from './Step';

const ALIASING = `class Punto {
    int x, y;
    Punto(int x, int y) { this.x = x; this.y = y; }
}

public class Demo {
    public static void main(String[] args) {
        Punto a = new Punto(1, 2);
        Punto b = a;
        b.x = 99;
    }
}`;

const CALL_STACK = `int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int r = factorial(3);`;

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const stepShowCatalogEntry: CatalogEntry = {
  name: 'StepShow',
  family: 'interactive',
  description:
    'Code on one side, arbitrary JSX on the other, both walked in sync by prev / next / reset controls. A generic primitive: the visual can be a memory diagram, a call stack, a tree, a queue, a sequence figure — anything the author writes inside a <Step>.',
  whenToUse:
    'Whenever the lesson requires the reader to see a fragment of code and its effect side by side, one step at a time. Introduced in #209 as the reversal of ADR-0028: the memory picture used to be drawn from an execution trace (a Java compile + JVM per diagram); <StepShow> takes author-written state and pairs it with a highlighted listing, at a fraction of the bundle. ' +
    'For memory specifically, use <MemoryVisual state={…}> inside each <Step> — it consumes a { frames, objects } state where references are values on the variables/fields themselves ({ kind: "ref", id }), never a top-level list (ADR-0043 §Decision-2). For other visuals (call stacks, trees, hash tables, sequence diagrams), drop any JSX inside a <Step> instead. ' +
    'The listing is deliberately not syntax-coloured: an editor here would put CodeMirror in the bundle of every page that steps through anything, and the highlight is a per-line box rather than tokenised colour — nothing would be gained by paying the weight. ' +
    'Bounded by author judgement, not by a cap: the widget renders every <Step> child it finds, in order. Anything other than a <Step> child is ignored, so a stray paragraph does not derail the counter.',
  props: [
    {
      name: 'code',
      type: 'string',
      description:
        'The listing shown on the code side, exactly as the reader should see it. Constant across steps.',
    },
    {
      name: 'language',
      type: 'string',
      description:
        'Informational label for the code (e.g. "java"). Not used for syntax colouring today; kept as a prop so a future highlighter can key on it without changing every consumer.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Heading shown in the widget header. Optional.',
    },
    {
      name: 'children',
      type: 'MDX',
      description:
        'One or more <Step lines={[…]}>…</Step> elements, in step order. Anything else is ignored — the widget owes the author a counter that matches what they wrote.',
    },
  ],
  examples: [
    {
      title: 'Two labels, one box — no runtime',
      code: `<StepShow code={code} language="java" title="Alias">
  <Step lines={[8]}>
    <p>Se crea el objeto y <code>a</code> lo apunta.</p>
  </Step>
  <Step lines={[9]}>
    <p><code>b</code> copia la flecha de <code>a</code>: dos etiquetas, una caja.</p>
  </Step>
  <Step lines={[10]}>
    <p>Modificar por <code>b</code> también cambia lo que ve <code>a</code>.</p>
  </Step>
</StepShow>`,
      render: () => (
        <StepShow code={ALIASING} language="java" title="Alias">
          <Step lines={[8]}>
            <p className="m-0">
              Se crea el objeto y <code>a</code> lo apunta.
            </p>
          </Step>
          <Step lines={[9]}>
            <p className="m-0">
              <code>b</code> copia la flecha de <code>a</code>: dos etiquetas, una caja.
            </p>
          </Step>
          <Step lines={[10]}>
            <p className="m-0">
              Modificar por <code>b</code> también cambia lo que ve <code>a</code>.
            </p>
          </Step>
        </StepShow>
      ),
    },
    {
      title: 'A step highlighting more than one line',
      code: `<StepShow code={code} language="java">
  <Step lines={[2, 3]}>
    <p>La condición base y la recursión, leídas juntas.</p>
  </Step>
  <Step lines={[6]}>
    <p>Cada llamada abre un nuevo marco encima del anterior.</p>
  </Step>
</StepShow>`,
      render: () => (
        <StepShow code={CALL_STACK} language="java">
          <Step lines={[2, 3]}>
            <p className="m-0">La condición base y la recursión, leídas juntas.</p>
          </Step>
          <Step lines={[6]}>
            <p className="m-0">Cada llamada abre un nuevo marco encima del anterior.</p>
          </Step>
        </StepShow>
      ),
    },
  ],
};

/** Catalog entry for the <Step> marker child of <StepShow>. */
export const stepCatalogEntry: CatalogEntry = {
  name: 'Step',
  family: 'interactive',
  description:
    'One step of a <StepShow>: the lines it highlights in the code panel and the JSX shown beside them. On its own <Step> renders nothing — the pair is the widget.',
  whenToUse:
    'Only as a child of <StepShow>. The author writes one <Step> per moment they want the reader to pause at: a marker to declare "when the reader is on this step, light these lines and show this."',
  props: [
    {
      name: 'lines',
      type: 'number[]',
      description:
        '1-based line numbers to highlight while this step is showing. May be empty — a step whose lesson is what appears beside the code, not which line is running, does not need a highlight.',
    },
    {
      name: 'children',
      type: 'MDX',
      description: 'Any JSX. Rendered in the visual panel while this step is showing.',
    },
  ],
  examples: [
    {
      title: 'A single-line highlight',
      code: `<Step lines={[9]}>
  <p>Aquí <code>b</code> copia la flecha de <code>a</code>.</p>
</Step>`,
      // A live standalone <Step> renders nothing on purpose. The example above
      // shows the source; the render is the ALIASING one above, where the
      // Step lives inside a StepShow.
      render: () => (
        <StepShow code={ALIASING} language="java">
          <Step lines={[9]}>
            <p className="m-0">
              Aquí <code>b</code> copia la flecha de <code>a</code>.
            </p>
          </Step>
        </StepShow>
      ),
    },
    {
      title: 'A step with no highlight (`lines={[]}`)',
      code: `<Step lines={[]}>
  <p>Al comienzo, todavía no hay línea que resaltar.</p>
</Step>`,
      // A step whose lesson is what appears beside the code, not which line is
      // running. Written inside a <StepShow> because a bare <Step> renders
      // nothing on its own.
      render: () => (
        <StepShow code={ALIASING} language="java">
          <Step lines={[]}>
            <p className="m-0">Al comienzo, todavía no hay línea que resaltar.</p>
          </Step>
          <Step lines={[8]}>
            <p className="m-0">Cuando se crea el objeto, se enciende la línea 8.</p>
          </Step>
        </StepShow>
      ),
    },
  ],
};
