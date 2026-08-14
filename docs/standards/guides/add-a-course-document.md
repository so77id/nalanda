# Guide — Add a course document

How to add (or move) a document in a Nalanda course. Registered in
`docs/standards/integration-guides.md`; born with WP2 (#63). Decisions behind
this design: ADR-0002 (ids, graph + index), ADR-0003 (MDX), ADR-0012 (pipeline),
ADR-0013 (presentation).

## When to use

You are writing course material: a new sección/presentación, an exercise page,
any content unit. No app code is involved — everything happens under `content/`.

## Worked example

The seed course `content/courses/sample-course/` exercises everything:

```
content/courses/sample-course/
├── 01-bienvenida.mdx          # presentation: auto     — h2 slicing; the suite's `auto` fixture
├── 02-intro-estructuras.mdx   # presentation: explicit — uses <Slide>
├── 03-busqueda-binaria.mdx    # presentation: explicit — uses <Slide>, plus a markdown ## (both h2 sources)
├── 04-apuntes.mdx             # presentation: none     — book-only
├── 05-codigo-ejecutable.mdx   # presentation: explicit — uses <CodeEditor>
├── 06-java-desde-cpp.mdx      # presentation: explicit — uses <SideBySide>
├── 07-java-tipos-y-flujo.mdx  # presentation: explicit — uses <Exercise> + <CodeEditor>
└── index.yaml                 # the ordered teaching path
```

Note the file names carry an ordering prefix but the **ids don't** — identity is
the frontmatter `id`, never the path. v0.1 supports exactly ONE course directory
(enforced at app startup); multi-course arrives with a later WP.

## Step-by-step

1. **Create the `.mdx` file** anywhere under `content/courses/<slug>/`. The
   folder/file layout is serialization only — organize freely, moves/renames
   never break links or routes as long as the id stays.

2. **Frontmatter** (required, YAML between `---` fences at the very top):

   ```mdx
   ---
   id: busqueda-binaria # kebab-case, UNIQUE across the whole content/ tree
   title: Búsqueda binaria # shown in the TOC, prev/next, and lookups
   presentation: explicit # auto | explicit | none — declare it, always
   ---
   ```

   `presentation` controls the document's slide form (ADR-0013): `auto`
   (default when absent) slices the deck on `h2` headings; `explicit` decks
   ONLY content marked with `<Slide>` / `<SectionBreak/>` (loose prose stays
   book-only); `none` means book-only — no Presentar toggle, `/present`
   redirects back.

   **Optional in the schema, required in practice — declare it even when you
   want the default** (#108, enforced by `src/content/architecture.test.ts`).
   The field defaults to `auto`, so a document that omits it still ships a deck;
   omitting it does not mean "no slides", it means slides nobody chose. Two of
   the documents here had exactly that, and one of them projected the book's
   own navigation sentence — _"Cuando termines, vuelve a la bienvenida"_ — alone
   on a slide.

   Deciding is cheap and takes one walk through `/d/<id>/present`. Note that the
   walk is the only way to find this: an undeclared deck is never clipped or
   unreadable, so nothing in the build or the suite can tell you it is wrong —
   only that it exists.

   > **The seed course is also the suite's fixture set**, and that constrains
   > what you may declare here. Several tests bind to real documents; three
   > constrain the presentation declaration:
   >
   > - `documentSections.test.tsx` names `bienvenida` (its `auto` fixture) and
   >   `busqueda-binaria` (its `explicit` one, chosen because it carries BOTH
   >   heading sources — `<Slide title>` h2s and a markdown `##` — which is the
   >   equivalence those cases assert).
   > - `presentationRoute.test.tsx` names `busqueda-binaria` too and drives
   >   `intro-estructuras`.
   > - `presentationRoute.test.tsx` also drives `java-desde-cpp` at a **fixed
   >   slide index** (`?slide=10`, the "Compilar y ejecutar" slide — the only one
   >   carrying a `<pre>`), so that document must stay presentable and keep its
   >   shape there. Nothing names it as a fixture; it is a bare URL in a test.
   >
   > That is why `01-bienvenida.mdx` declares `auto` rather than the `none` its
   > content would suggest: it is the only `auto` document left, and the rail's
   > markdown-`h2` path has no other real content to run over. Changing a
   > declaration here can therefore break a test that never mentions your
   > document — **run the full suite, not just the build** (#108).

3. **Write prose in Markdown.** Headings h2–h4 get automatic slug anchors
   (deep-linkable). Code fences render book-style.

   **`h2` is also the section spine** (ADR-0021): every `h2` the page paints
   becomes an entry in the "En esta página" list — the rail from `2xl`, the
   drawer below it. `h3`/`h4` stay deep-linkable but never appear there, so a
   document you want navigable is structured with `##`. A document with no `h2`
   at all simply has no section navigation, which is a choice rather than a bug
   (`04-apuntes.mdx` is the worked case).

   Running text is narrowed to ~70 characters inside the 768px column, while
   code, tables and components keep the full width (ADR-0022). You write nothing
   for this; it matters only if you add a component of your own — see
   `add-a-content-component.md`.

   **A fence in a language the platform runs is highlighted and copyable.**
   ` ```java `, ` ```cpp ` and ` ```python ` render through
   the same editor the runnable blocks use — same colours, a copy button, and
   not editable or runnable (#85, ADR-0024). Write the language whenever the fence holds
   code. A fence with **no** language, or one the platform has no runtime for
   (` ```bash `), stays plain monospace and loads nothing — which is what
   an ASCII diagram wants.

   **The three ids are matched exactly**, so an alias is silently a different
   language: ` ```C++ `, ` ```c++ `, ` ```py ` and
   ` ```Java ` all fall through to plain monospace. Nothing warns you —
   the page renders, it just renders grey. If a fence you expected to be
   coloured is not, check its tag before anything else.

   Three consequences worth knowing, all measured rather than assumed:

   - The **first** highlighted fence on a page pulls the editor: ~162 kB gzip
     of CodeMirror, its parser and the language grammar — lazily, never in the
     entry chunk, and it roughly doubles the JavaScript of a prose page
     (ADR-0018 §Consequences). Further fences on the same page are free. No
     runtime is fetched — a listing runs nothing — so this is not the CDN cost
     the Run button pays.

   - In the book a listing is never given a scrollbar of its own; the page
     scrolls. On a slide it keeps one, because the screen does not grow.
   - The reader's own `Ctrl+F` still finds text inside a listing, including
     lines scrolled out of view on a slide. Measured on
     `06-java-desde-cpp.mdx`: in the book at 1440px and at 390px, and on a slide
     with the window shortened enough for the 55vh cap to bite — 51px hidden,
     still found. This is worth stating because it is not
     guaranteed in general: the editor renders by viewport, so a listing of
     hundreds of lines could hide its tail from the browser's search. Nothing in
     a course document is near that size (the longest here is 27 lines), and if
     you ever write one that is, split it.

3b. **Write mathematics (optional)**: delimited by **two** dollar signs, never one.

   ```mdx
   Sobre $$n$$ elementos hay a lo más

   $$
   \lfloor \log_2 n \rfloor + 1
   $$

   iteraciones.
   ```

   Inline and display differ by **where the delimiters sit**, the way a code
   fence does: `$$x$$` on one line is inline, `$$` alone on its own lines opens
   a block. One line break apart, and the two look nearly identical in a diff.

   **Two dollars, not one — and this is the part that will surprise you if you
   have written LaTeX before** (ADR-0027 §2). With single-dollar math enabled,
   an ordinary sentence about money becomes a formula:

   ```
   Cuesta $200 al mes, el otro $350.
   ```

   would render "200 al mes, el otro" as mathematics, with a green build and no
   warning of any kind. The alternative breaks prose written by someone who
   never intended to write mathematics at all.

   **If you paste a formula written with single dollars, it does not merely stay
   as text.** MDX reads braces as expressions, so `$\frac{1}{2}$` renders as
   `$\frac12$` — the braces silently gone — and `$\sum_{i=1}^{n} i$` **fails the
   build** with `ReferenceError: i is not defined`. Retype the delimiters; the
   `$$` form takes its content raw and is immune.

   **An unclosed `$$` eats the rest of the page.** Not one red formula: the
   prose below it, the headings, everything, swallowed into a single error span
   — so the section list empties and, in an `auto` document, every slide below
   the typo vanishes from the deck. The build stays green and the content gate
   sees nothing, because it checks frontmatter and the index, not body syntax.
   The symptom to recognise is *"the document ends here"*.

   **A decimal comma needs braces.** This one will bite a Spanish-language
   course immediately, and it is silent. In mathematics a comma is *punctuation*,
   so `0,25` renders as `0, 25` — with a gap — and its MathML comes out as three
   tokens (number, operator, number) instead of one number, which is what a
   screen reader reads aloud. Write `0{,}25`:

   ```mdx
   $$
   N_p = 0{,}25\,S_1 + 0{,}25\,S_2 + 0{,}25\,N_{TC} + 0{,}25\,N_L
   $$
   ```

   The `\,` between the number and the symbol is a thin space, which is how
   multiplication is conventionally set. Neither is optional if you want the
   formula to read as mathematics rather than as a list.

   **A heading wants text in it.** `## $$\log_2 n$$` — a heading that is only a
   formula — gets no id, no anchor and no entry in the section list, silently.
   Write `## El costo, $$\log_2 n$$` instead.

   **A `<Slide title="...">` cannot hold a formula**: the title is a JSX
   attribute, so the `$$` ship to the reader as literal characters, projected.
   Put the formula in the slide **body** instead, with a blank line above and
   below the `$$` block like any markdown inside JSX, and keep the title plain:

   ```mdx
   <Slide title="Cómo se calcula tu nota">

   $$
   N_p = 0{,}25\,S_1 + 0{,}25\,S_2
   $$

   </Slide>
   ```

   Three things worth knowing, all measured rather than assumed:

   - **No JavaScript is shipped.** KaTeX renders during the build, so a formula
     costs the reader a stylesheet and the font faces its own glyphs use — about
     42 kB for a typical formula, against ~162 kB gzip of editor for the first
     highlighted fence on a page (ADR-0018). The stylesheet is global — **3.94 kB
     gzip on every page in the site**, including pages with no mathematics
     (measured 2026-08-14; ADR-0027 §3 carries the figure and why it is debt). A
     page without a formula downloads **no fonts at all**.
   - **A malformed formula does not fail the build.** It renders in KaTeX's
     error colour, like a broken wiki-link renders visibly broken. Nothing stops
     you publishing it — look at the page.
   - **On a slide it is fine but not free.** A long display equation is wide, and
     ADR-0013 scales the whole slide down rather than clipping — so a formula
     that does not fit shrinks the prose beside it. No shipped document puts a
     formula in a deck yet, so there is no measured example to copy: check any
     slide carrying one, in landscape, and judge it yourself.

   Screen readers are covered: KaTeX emits MathML beside the visual rendering,
   so a formula is read as mathematics rather than skipped as decoration.

4. **Mark slides (optional)**: `<Slide title="...">...</Slide>` and
   `<SectionBreak />` are available WITHOUT imports. In the book view a Slide
   renders as its heading + flowing prose and a SectionBreak as a subtle
   divider; in presentation they cut slide boundaries. Worked example:
   `03-busqueda-binaria.mdx`.

   A `<Slide title>` renders that same `h2`, so **slide titles appear in the
   section list** — one more reason to give every Slide a title. An untitled
   Slide cuts a slide but contributes no section.

5. **Add runnable code (optional)**: `<CodeEditor language="java" />` is
   likewise available without imports — Java, C++ or Python, compiled and run in
   the reader's own browser. Worked example: `05-codigo-ejecutable.mdx`.

   > **Java has a sharp edge.** It runs on the page's main thread (ADR-0017), so
   > a student's `while (true)` freezes the tab and nothing recovers it — they
   > must close it. C++ and Python run in workers and are cut off cleanly, so
   > prefer them whenever the language does not matter to the lesson.
   >
   > When it does — a Java course teaching Java loops — ship it anyway, with
   > eyes open (accepted for #76). The editor is saved to `localStorage`
   > immediately before every run, so a frozen tab costs the reader a reload
   > rather than their work — but only what was in the editor **at that run**:
   > edits made and never run are lost. Warn in the prose where a loop is the point, keep
   > runaway inputs out of your examples, and never leave such an editor where
   > an unattended reader has no way to recover.

   Use a reading variant (`variant="read"`) for code you only cite: it loads no
   compiler at all.

5b. **Add an exercise (optional)**: `<Exercise>` gives the reader a problem to
solve, checked automatically in their browser. The statement is ordinary
prose; two annotated fences carry the rest:

````mdx
<Exercise title="¿Es par?">

Escribe `esPar`, que devuelve `true` si el número es par.

```java starter
class Solution {
    static boolean esPar(int n) {
        return false;
    }
}
```

```java test
check(Solution.esPar(4), true);
check(Solution.esPar(7), false);
```

</Exercise>
````

The `test` fence is inlined as the body of a generated `main` (in class
`NalandaCheck`), which is compiled beside the student's class and calls it —
so what is checked is the method, not what the program printed. Two
consequences worth knowing before you write one:

- **Statements only.** No method or field declarations: they are legal in a
  class body and illegal in a method body. Get it wrong and the _student_
  sees compiler errors for code they never wrote.
- **`check(obtenido, esperado)`** — the student's value first, the expected
  value second. Reversed, it still compiles and the feedback reads backwards.
  `check` is the only helper available, overloaded for `int`, `long`,
  `double` (compared with a 1e-9 tolerance, never `==`), `boolean`, `char`,
  `Object` (arrays compared by contents) and `int[]`, `long[]`, `char[]`,
  `boolean[]`.

The class named in `starter` and the one the cases call must agree.
**Only Java validates**; C++ and Python refuse an exercise rather than report
a pass for something they never checked. Three class names are reserved by the
platform — `NalandaLauncher`, `NalandaCheck` and `NalandaTrace` — and a Java
program whose MAIN class is one of them is refused before it compiles, in an
exercise or a plain editor alike. A *secondary* declaration is not caught; that
hole and why it is tolerated are in `docs/security-notes.md`.

Editing a shipped `starter` fence changes the key its drafts are stored
under: every student's saved attempt at that exercise becomes unreachable
(ADR-0020 §3). Fixing a typo in a starter is cheap; rewriting one after a
class has used it is not.

The cases are hidden until the first run — pacing, not secrecy. Everything
under `content/` is published, so the page source reveals them to anyone who
looks: never author an exercise whose cases must stay private.

Worked example: `07-java-tipos-y-flujo.mdx` (six exercises, one of them on a slide).

5c. **Compare two listings (optional)**: `<SideBySide left="C++" right="Java">`
places exactly two blocks next to each other, stacking on a narrow screen.
For a course whose students already program, the comparison is often the
lesson itself. Half the page is all a column gets: check the longest line of
both listings on a slide, not only in the book.
Worked example: `06-java-desde-cpp.mdx`.

Full usage docs, props and live examples for every document-facing component
live in the catalog — browse `/catalog`, which is generated from the components
themselves rather than maintained by hand.

5d. **Draw the memory (optional)**: `<MemoryDiagram>` shows variables, stack
   frames and heap objects — **taken from the snippet actually running**, never
   from a description you write. You mark where you want a photograph and which
   variables belong in it:

   ````mdx
   <MemoryDiagram title="Dos variables, un objeto">

   ```java trace
   class Punto {
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
   ```

   </MemoryDiagram>
   ````

   `// foto a, b` photographs those two variables at that line. `// foto
   marco: p, q` opens a second frame — needed whenever the lesson is about a
   method call, because a caller and a callee have to be on screen together —
   and `// foto-fin marco` closes it. **Name the variables you want drawn and no
   others**: naming them is what lets this work without a Java parser, and it is
   also how you keep the picture down to what teaches.

   The markers are removed from what the reader sees, and every line keeps its
   number, so the highlighted line is the one you marked.

   Seven things worth knowing before you write one:

   - **Java only**, and Java 8 like everything else here. C++ and Python get a
     refusal rather than an empty drawing.
   - **Primitives are drawn as values, objects as arrows.** That distinction is
     automatic and is usually the point.
   - **Two `new String("hola")` draw as two boxes**, because identity is what is
     tracked. That is what makes the `==` trap visible instead of asserted.
   - **A marker inside a branch that never runs produces no photograph.** The
     build cannot see this — the component says so after the run, and only then.
   - **It cannot draw recursion.** Frames are identified by the name you write in
     the marker, so three nested calls to `fact` draw **one frame** holding the
     innermost values — depth 1 for a stack of 3. This is the only case where the
     drawing can teach the opposite of the truth, which is why it is stated here
     rather than left to be found: the call stack needs a different component
     (Discussion #49).
   - **Caps**: 40 photographs, 12 objects drawn in total, and 32 elements or
     fields per box. A `// foto` inside a loop hits the first; a big structure
     hits the others. In every case the component says so rather than showing a
     partial trace as if it were complete — including when the program printed so
     much that the runtime cut the trace off.
   - **`NalandaTrace` is a reserved class name**, like `NalandaLauncher` and
     `NalandaCheck`. A snippet declaring it is refused before compiling.

   **The compiler** is not downloaded until the reader presses *Ejecutar y
   dibujar*. Mounting is not free, though: it pulls ~120 kB gzip of Java runtime
   module and CodeMirror grammar the component never uses (measured; returning it
   is #122), so do not put many diagrams on one page yet.

   Decisions behind all this: ADR-0028. Worked examples, live:
   `/catalog/c/MemoryDiagram`.

5e. **External links**: write them as explicit `https://`. Markdown now parses
GFM, so a bare URL becomes a link on its own — and a bare `www.host` resolves
to **`http://`**, a cleartext link the reader can be downgraded on. Tables,
strikethrough (`~~`), task lists and footnotes also work now.

6. **Cross-reference with wiki-links**: `[[otro-id]]` renders that document's
   link, `[[otro-id|texto visible]]` overrides the label. A target that doesn't
   exist does NOT fail the build: it renders visibly broken (red wavy underline)
   and logs a console warning — forward links to drafts are allowed on purpose.

7. **Register it in the teaching path** (`index.yaml`) if it belongs to the
   recorrido. Schema (strictly validated; unknown keys fail the build):

   ```yaml
   title: Estructuras de Datos # optional course name; the first crumb of the breadcrumb
   entries: # the list of stops (title and entries are the only root keys)
     - docId: bienvenida # leaf entry: just a document reference
     - label: Fundamentos # group entry: children + label (required unless it has a docId)
       levelName: Unidad # optional display name for the level (D8)
       children:
         - docId: intro-estructuras
         - docId: busqueda-binaria
   ```

   Depth-first order of `entries` = reading order (TOC, prev/next, and `/` lands
   on the FIRST entry — by convention the course welcome document). A document
   not listed in the index is still compiled and served at `/d/<id>`: **the index
   controls navigation, never visibility.**

   > **Unlisted is legal at runtime but not in the suite.**
   > `app/documentBreadcrumb.test.tsx` asserts that every document in the
   > registry is indexed, so an unlisted document serves fine and turns the
   > protocol red. Two consequences: a real document must be listed, and a
   > scratch document written to check a component in a browser must be **deleted
   > before you run the suite** (#116 used exactly that trick to verify
   > presentation mode, and hit this on the way).

   `title` names the course wherever the reader needs to know which one they are
   in — today the breadcrumb above every document. Omit it and the trail starts
   at the unit; give it an empty or non-string value and the build fails like any
   other field.

8. **Verify**: `npm run build` from `apps/web/`. The contentIntegrity gate fails
   the build (and CI — `content/**` triggers it) with a file-and-field message
   on: missing/non-kebab/duplicate `id`, missing `title`, invalid `presentation`
   value (must be auto, explicit, or none), malformed `index.yaml` (unknown key,
   group without docId nor label, empty children), duplicate or unknown `docId`
   in the index.

   **A build cannot see inside an exercise or a diagram.** The fence labels are matched when
   the component renders, and the cases are Java compiled in the reader's
   browser — so a mistyped ` ```java Starter ` or a `test` fence that does
   not compile ships with a green build and a green suite. Open the document
   before the PR (`npm run build && npm run preview`, then
   `/nalanda/d/<id>`) and run every exercise you added: no amber authoring
   banner, the cases pass against a correct solution, and they fail against the
   starter. If a `<SideBySide>` or a `<Slide>` is involved, look at it in
   presentation mode too — `/d/<id>/present`. A listing wider than the slide is
   **panned with a one-finger drag inside it** on a touch device, and that drag
   no longer advances the deck (#103, ADR-0013 §5.2) — so its tail is reachable,
   but only from inside the listing; a swipe anywhere else still changes slide.
   Worth dragging one in landscape when you check. **Slides are checked in
   landscape**: on a phone or tablet held upright the viewer deliberately shows
   a "Gira el teléfono" panel instead of the deck (ADR-0023), so an empty
   presentation there is the platform working, not a fault in your document.
   **What you are checking is legibility, not completeness** (ADR-0013 §5.1):
   a slide too tall or too wide is no longer clipped, it is scaled down whole,
   so nothing disappears and instead everything shrinks. Measured on a phone in
   landscape (2026-08-13, iPhone 13 at 750x342): below roughly half scale the
   body text stops being readable. If a slide gets there, the fix is yours and
   not the viewer's — split it at a `<SectionBreak/>`, or shorten the listing.
   The same applies to width: an over-wide `<SideBySide>` column now shrinks
   the ENTIRE slide rather than overflowing on its own.

9. **Publish**: merging to `main` republishes
   <https://so77id.github.io/nalanda/> automatically — `content/**` is a deploy
   trigger (ADR-0015). **Everything under `content/courses/` becomes public**,
   listed or not: material that must not be seen (exam keys, solutions,
   unreleased classes) does not belong here — omitting it from the index is not
   a control (`docs/security-notes.md` §Accepted invariants). Check the document
   on the live URL after the merge.

## Checklist

- [ ] Frontmatter has kebab-case `id` (unique) + `title` + `presentation` —
      declared even when the value is the default (`architecture.test.ts` fails
      otherwise).
- [ ] The deck the chosen value produces was walked once in `/d/<id>/present`,
      unless the value is `none`.
- [ ] Wiki-links point at real ids (or are intentional forward links).
- [ ] Listed in `index.yaml` if it belongs to the recorrido.
- [ ] `npm run build` **and** `npm run test` green from `apps/web/`. The build
      runs the content integrity gate; the declaration invariant and the fixture
      guards live in the suite, so the build alone goes green on content CI
      rejects (#108).
- [ ] Every `<MemoryDiagram>` opened in `npm run preview` and stepped through:
      photographs appear (no "ninguna foto" notice), the listing shows no `// foto`
      markers and keeps every line number, and no cap notice unless you meant it.
      Same reason as the exercises below — nothing in the build or the suite can
      see any of it.
- [ ] Every exercise opened in `npm run preview` and actually run: no authoring
      banner, cases pass against a correct solution and fail against the starter.
      Nothing in the build or the suite can check this for you.
- [ ] Anything on a slide looked at in presentation mode, not only in the book.
- [ ] Every formula looked at on the rendered page. A malformed one publishes in
      KaTeX's error colour and an unclosed `$$` swallows the rest of the
      document, both past a green build. Check the page still ends where you
      wrote its end, and check any slide carrying a formula in landscape.
- [ ] Content language: Spanish is fine (user-facing course material).
- [ ] Nothing here must stay private — merging publishes it at `/d/<id>`.
