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
    'Code above, arbitrary JSX below — stacked, both full width, both walked in sync by prev / next / reset controls; with `beside`, side by side on a slide. A generic primitive: the visual can be a memory diagram, a call stack, a tree, a queue, a sequence figure — anything the author writes inside a <Step>.',
  whenToUse:
    'Whenever the lesson requires the reader to see a fragment of code and its effect together, one step at a time. Stacked rather than side by side: two columns inside a document measure scaled the drawing to unreadable (#116). In presentation it breaks out of the Slide prose column to HALF the viewport on its own, so never wrap it in <PresentationWide> (ADR-0067), one step at a time. The one exception to the stack is `beside`, for a listing too long to stack over its drawing on a slide: there the drawing sits to the right of the code and the widget takes three quarters of the viewport, while the book keeps the stack (#322: the whole class of the BST iterator, twenty-eight lines walked in one widget, put the slide at 0.577 stacked and at 0.755 beside). Introduced in #209 as the reversal of ADR-0028: the memory picture used to be drawn from an execution trace (a Java compile + JVM per diagram); <StepShow> takes author-written state and pairs it with a highlighted listing, at a fraction of the bundle. ' +
    'For memory specifically, use <MemoryVisual state={…}> inside each <Step> — it consumes a { frames, objects } state where references are values on the variables/fields themselves ({ kind: "ref", id }), never a top-level list (ADR-0049 §Decision-2). For other visuals (call stacks, trees, hash tables, sequence diagrams), drop any JSX inside a <Step> instead. ' +
    "The listing is syntax-coloured — `<CodeStepper>` loads the language's grammar through `loadGrammar`, which is why StepShow registers behind a lazy wrapper — and the step highlight is a per-line box over it. A Java method written on its own colours too (#322: the grammar re-reads it as the members of a class). " +
    'Bounded by author judgement, not by a cap: the widget renders every <Step> child it finds, in order. Anything other than a <Step> child is ignored, so a stray paragraph does not derail the counter. ' +
    "It keeps one size while it runs (#363): every step's drawing, and every `under`, is laid in one cell with only the current one visible, so the widget is the size of its largest frame from step 1 and the slide scaled to fit it never moves. In the book a walk far from the viewport lays only its current and last frames and lays the rest within a screen of it, so make the last frame the largest; what is yours is drawing every frame at its final layout, what does not exist yet drawn empty.",
  props: [
    {
      name: 'code',
      type: 'string',
      description:
        'The listing shown on the code side, exactly as the reader should see it. Constant across steps. Or, instead, `codeSrc`; giving both is an authoring error.',
    },
    {
      name: 'language',
      type: 'string',
      description:
        'The language the listing is coloured as (e.g. "java"): a runtime id loads that grammar through `loadGrammar`, anything else falls back to Java (`CodeStepper.tsx`).',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Heading shown in the widget header. Optional.',
    },
    {
      name: 'beside',
      type: 'boolean',
      description:
        'On a slide, the drawing sits beside the listing instead of under it, and the widget breaks out to three quarters of the viewport instead of half. The book ignores it and stacks. For a long listing with a small drawing; default false.',
    },
    {
      name: 'program',
      type: 'string',
      description:
        'The program that calls the listing, shown over it as a listing of its own headed «programa», with `code` under it headed `codeName`; each <Step> lights `programLines` in it and `lines` in `code`. For a walk whose lesson is a call and what it does inside — the calls addEdge(0, 1)… over addEdge itself (#363), as <SequenceStepper program> does for its methods. Optional; without it, `code` alone — unheaded unless it has a name (`codeName`, or the file `codeSrc` quotes) or a step has `under`.',
    },
    {
      name: 'codeSrc / programSrc / helperSrc',
      type: 'string',
      description:
        'Instead of the listing text, the file it quotes: a path relative to the document (./26-grafos-tda-modelado.code/AdjMatrixGraph.java, ADR-0091), resolved like a figure src. The listing then takes the header <SourceFile> gives — the file name, the range, an open button, fold rows for what it leaves out — numbers its lines as the file does, and its <Step> lines name FILE lines — a line outside the range is an authoring error naming the step. Only .java files are quotable (lib/contentCode.ts globs content/**/*.java), and the path must be a quoted string. Ver archivo opens every file of the walk, one tab each (a file quoted twice gets two), with the quoted lines banded and the step lit; the arrows walk the step from there.',
    },
    {
      name: 'codeRange / programRange / helperRange',
      type: 'string',
      description: 'The lines of the file quoted, "12-16"; the whole file without it.',
    },
    {
      name: 'helper',
      type: 'string',
      description:
        'With `program`, a method between the program and `code`: the one the program calls and that calls `code` in turn — readEdges between the program that reads a graph and addEdge (#363). Shown under the program, headed `helperName`; each <Step> lights `helperLines` in it. Optional.',
    },
    {
      name: 'helperName',
      type: 'string',
      description: 'The heading of `helper`.',
    },
    {
      name: 'ratio',
      type: "'55/45' | '50/50' | '60/40' | '40/60'",
      description:
        'With `beside`, how the slide splits between code and drawing, as "code/drawing" percentages; default "55/45". "50/50" or "40/60" for short listings beside a drawing of two pictures stacked, "60/40" for a wide program (#363). Any other value renders an authoring error. Ignored in the book and without `beside`.',
    },
    {
      name: 'codeName',
      type: 'string',
      description:
        'The file `code` stands for (AdjMatrixGraph.java), shown as a badge over it (#363). With `program` it heads the method listing (defaults to the Spanish word for method); alone, it heads the one listing, which otherwise has none.',
    },
    {
      name: 'programName',
      type: 'string',
      description:
        'The file the `program` listing stands for (Main.java), as its badge. Defaults to the Spanish word for program.',
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
      title: 'A program over the method it calls (`program`)',
      code: `<StepShow language="java" program={program} codeName="sumar" code={code}>
  <Step programLines={[1]} lines={[1, 2]}>
    <p>sumar(2, 3) retorna 5, y a vale 5.</p>
  </Step>
  <Step programLines={[2]} lines={[1, 2]}>
    <p>sumar(5, 4) retorna 9, y b vale 9.</p>
  </Step>
</StepShow>`,
      render: () => (
        <StepShow
          language="java"
          title="Dos llamadas a sumar"
          program={`int a = sumar(2, 3);\nint b = sumar(a, 4);`}
          codeName="sumar"
          code={`static int sumar(int x, int y) {\n    return x + y;\n}`}
        >
          <Step programLines={[1]} lines={[1, 2]}>
            <p className="m-0">sumar(2, 3) retorna 5, y a vale 5.</p>
          </Step>
          <Step programLines={[2]} lines={[1, 2]}>
            <p className="m-0">sumar(5, 4) retorna 9, y b vale 9.</p>
          </Step>
        </StepShow>
      ),
    },
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
      name: 'programLines',
      type: 'number[]',
      description:
        'The 1-based lines lit in the StepShow’s `program` listing at this step — the call the step is inside. Ignored when the StepShow has no `program`.',
    },
    {
      name: 'under',
      type: 'JSX',
      description:
        'Shown in the code column, under the listings: what the program holds after this step — the variables its calls assigned, a value returned — beside the lines that produced it (#363). If any step has one, every step keeps the room, so the column does not jump.',
    },
    {
      name: 'helperLines',
      type: 'number[]',
      description:
        'The 1-based lines lit in the StepShow’s `helper` listing at this step. Ignored when the StepShow has no `helper`.',
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
