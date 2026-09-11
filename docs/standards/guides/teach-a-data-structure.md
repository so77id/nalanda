# Guide — Teach a data structure

The shape every class of the **Estructuras de Datos** unit takes. Born with
#277, the unit's first class, which is also its worked example.

This is the third layer of the course-authoring stack, and the three do not
overlap:

- [`add-a-course-document.md`](add-a-course-document.md) — the **mechanics**:
  frontmatter, slide markers, figures, wiki-links, the index.
- [`course-content-style.md`](course-content-style.md) — the **voice**: formal
  first-person plural, neutral Spanish, noun-phrase titles.
- **This file** — the **shape**: what a class about a data structure contains,
  in what order, and in which of four repeated formats.

Read all three before writing a class of this unit. Nothing here overrides
either of the other two.

## When to use

You are writing a class of the Estructuras de Datos unit — a TDA, a structure
that implements one, or a family of variants. The unit is a sequence of
classes that all answer the same four questions about a different object, and
the reader learns the answers faster because the questions never move.

Do **not** use it for a class that is not about a data structure: a class about
an algorithm design technique (divide y conquista, ordenamiento) has its own
arc and its worked cases are chapters 15 and 16.

## Worked example

`content/courses/sample-course/17-edd-introduccion.mdx` — _Estructuras de
Datos · Introducción_. It establishes the vocabulary, introduces the Sequence
TDA, formalises the array as its first implementation, and evolves that into
the dynamic array. Three acts, 38 authored slides plus two act dividers and
the cover, seven static SVG figures, ten `<StepShow>` steppers, zero new
widgets and — deliberately — no runnable `<CodeEditor>`: every snippet in the
class is short enough to read, and a run button on one of them would have
implied the others were worth running too. (Counts re-derived with the greps named in §1 at the commit that shipped
the document; re-run them before quoting them.)

Its seven figures sit beside it in the same directory
(`tda-eda-invariante.svg`, `arreglo-memoria.svg`, `arreglo-alocacion.svg`,
`arreglo-invariante-valido.svg`, `arreglo-invariantes.svg`,
`regla-del-cuarto.svg`, `costo-acumulado.svg`), per the asset rule in
[`add-a-course-document.md`](add-a-course-document.md) §6.

**Second worked example:** `content/courses/sample-course/18-edd-listas-enlazadas.mdx`
— _Estructuras de Datos · Listas Enlazadas_. One structure and four variants
of it, 49 authored slides plus the cover, two act dividers (a
`<SectionBreak />` before the operations act and before the variants act; the
comparison and the exercises are bare `h2`s — see §1), no figures, thirteen
`<SequenceStepper>` widgets and five `<Exercise>`s. It is the class
that settled the act mapping above and the unit's widget decision (§7,
ADR-0074). Where #277 draws its step-by-steps as static SVG, this one derives
them, and §6 records why both remain right. (Counts re-derived with
`grep -c '^<Slide title=' …` and `grep -c '<SequenceStepper' …`; the deck's own
counter reads 48, and no slide scales below 0.70 at 1440x900.)

## Step-by-step

### 1. Lay out the acts

Each act is a markdown `h2` preceded by a `<SectionBreak />`, with the act's
slides inside it.

**The four acts are four QUESTIONS, not four `h2`s.** That was open when this
guide was written from a single class; #288 supplied the second data point and
settles it. The questions below are answered in this order every time, but the
number of headings a class carries is decided by **how many structures it
presents**, because each structure runs the cycle once:

- #277 presents two (the array, then the dynamic array) and runs the cycle
  twice, in an opening stretch with no heading plus two `h2`s.
- #288 presents one structure and four variants of it: an opening stretch with
  no heading that runs the full cycle over the base list, then one
  `h2` per group of the remaining questions — the operations in detail, the
  variants, the comparison, the exercises.

So do not count headings against the table. Check instead that the four
questions are answered, in order, for every structure the class introduces —
and that a variant answers only the ones it changes (§3).

| Acto | Contenido                                                                                  |
| ---- | ------------------------------------------------------------------------------------------ |
| 1    | La idea — qué problema resuelve esta estructura y de qué estructura conocida se diferencia |
| 2    | Los invariantes — qué propiedades sostiene, y por qué cada una importa                     |
| 3    | Las operaciones y sus costos — cada una con el invariante que restaura                     |
| 4    | Las limitaciones y la bisagra — qué NO resuelve, y qué estructura lo resuelve              |

The chapter that opens the unit deviates and says so: #277 spends act 1 on the
vocabulary itself, act 2 on the Sequence TDA and the array that implements it,
act 3 on the dynamic array — running the idea/invariantes/costos/limitaciones
cycle twice, once per array.

**Both classes put the hinge in the last slide of the last act, and neither
gives it a heading of its own.** That is now a rule rather than a coincidence:
question 4 is a slide, not a section. The closing navigation follows it, and
may be EITHER a book-only `## Lo que sigue` (#277) or a titled
`<Slide title="Lo que sigue">` as the deck's last slide (#288, whose deck
otherwise ended on a comparison table and stopped). Pick one deliberately;
what stays forbidden is the UNCHOSEN slide — a `<SectionBreak />` before a
loose `## Lo que sigue`, which projects the closing as an untitled divider
(the defect #79 shipped). Either way it is book-visible,
and says which document comes next — which is a different job (§5).

**It also cut its own act 4.** An earlier draft closed with a recap act ("un
contrato para los dos arreglos") that restated the TDA, put the two cost
tables side by side and named the trade. Every one of those was already on the
page: the contract in act 2, each table at the end of its own act. Only the
trade survived, as the last slide of act 3. Prefer that: a recap act is the
default place for a class to repeat itself.

**The first act carries no heading at all.** #277 opens straight from the
cover into its first slide. A divider between the cover and the opening slide
is a beat with nothing in it — the reader has not been given anything to be
divided from yet — and a bare `h2` there only adds a book section whose title
repeats what the document's own lead paragraph just said. Headings, and the
`<SectionBreak />` that turns them into divider slides, start at the second
act.

**The `<SectionBreak />` before an act heading is deliberate and it is a
decision, not decoration.** In `explicit` mode a break opens a group and the
loose `h2` after it lands inside (`presentation/parser.ts`), so the act
heading becomes a **title-only divider slide** — which is what a lecture wants
between acts. Chapter 16 ships the same shape.

**Never put a `<SectionBreak />` before `## Lo que sigue`.** The same mechanism
would project the closing navigation as a slide — the defect #79 shipped
(`add-a-course-document.md` §4), and the same class of unchosen slide that
#108 exists to prevent. Without a break, `open` is null and the closing prose
stays book-only.

### 2. Define a TDA in one shape

**Vocabulary note — TDA and EDA.** The unit runs on a pair of acronyms:
**TDA** is the contract (what can be asked) and **EDA** the implementation
(how it is stored and what each request costs). #277 introduces "tipo de dato
abstracto (TDA)" and spells the other half out in full. **#288 planned to
introduce EDA and did not**: the definition was drafted into its opening act
and cut during the slide-by-slide review, and the review pipeline then
measured the shipped document and found the acronym in no line of prose.

So the rule this leaves is the one that matters: **an acronym a class puts on
screen is an acronym that class has defined.** #288's widget chip said `eda`
thirteen times over a document that never said the word, which is why the chip
now reads `estructura`. Either introduce the pair in the opening act and use
it, or use the words in full — do not let a component's chrome introduce
vocabulary the prose never does.

**Vocabulary note — "colección".** The course uses it as the general umbrella
word ("a group of elements stored together"), which is the theory's sense and
the one five earlier chapters already use — chapter 8 writes "las colecciones —
`List`, `Map`, `Set`". Java also has `java.util.Collection`, a narrower thing:
`List`, `Set` and `Queue` extend it and **`Map` does not**. The two senses do
not clash for Sequence, so #277 deliberately adds no caveat. **They do clash
for a map**, so the class that introduces the Map/diccionario TDA owes the
distinction one sentence — otherwise a student who bound the word to Java's
interface will trip on "un mapa es una colección". Same family as the
`interface` overload that #277 had to untangle in its own Act 1.

A TDA is introduced as a **contract**, on one slide, in a card the unit reuses
for every TDA it defines. The card is language-independent on purpose — Java's
names for the same contract get their own slide afterwards.

1. Above the card, one sentence saying what the collection IS, and what orders
   its elements.
2. The card itself: a header naming the TDA, then one group per **mould** —
   `CREAR`, `CONSULTAR`, `MODIFICAR` — each group a two-column grid of
   signature and meaning. The moulds come from MIT 6.005/6.031
   (creators/observers/mutators); the signature-plus-meaning layout from the
   API tables in Sedgewick & Wayne. Shortcuts the prose defines immediately
   below may share a row: #277 pairs `insertFirst`/`deleteFirst`.
3. A closing `LO QUE NO DICE` block, on the sunk background, naming what the
   contract deliberately leaves open (memory layout, capacity, cost). That is
   what makes many implementations possible, and it belongs inside the card
   rather than in prose after it — it is part of the contract.

**Build the card with inline `style` and palette tokens, never Tailwind
classes**: Tailwind's scanner is rooted at `apps/web`, and `content/` sits
outside it, so a utility class written only in an `.mdx` is never generated
and the element paints unstyled past a green build
(`add-a-course-document.md` §5, which is the fact's home). Colour the group
labels — `--color-ink-faint` for CREAR, `--color-keep` for CONSULTAR,
`--color-accent` for MODIFICAR — so the reader recognises the same three
moulds in the next class. Avoid `--color-accent-soft`: the `accent-` prefix
trips the colour guard in `apps/web/src/architecture.test.ts`.

**There is no `<TdaCard>` component — the card is copied.** Take the block
from the slide _El TDA Sequence_ in
`content/courses/sample-course/17-edd-introduccion.mdx`, keep its structure
and change only the rows. What has to survive the copy: the frame is
`border: 1px solid var(--color-rule)` + `borderRadius: 8px` +
`overflow: hidden`; the body is one `display: grid` with
`gridTemplateColumns: 'max-content 1fr'` so the meanings line up across ALL
the groups; each mould label is a `gridColumn: '1 / -1'` row at
`fontSize: 0.7rem` / `letterSpacing: 0.08em` / `fontWeight: 700`, separated
from the group above by `borderTop: 1px solid var(--color-rule)`; signature
cells are `<code>` with `whiteSpace: 'nowrap'`. Extract a component at the
third copy, not before, and record it here when you do.

Costs never appear in the contract. They belong to an implementation, and
putting them here is the single mistake that collapses the TDA/EDA distinction
the unit is built on.

Worked case: #277, slide _El TDA Sequence_, with _El contrato en Java · List_
right after it mapping every operation to its `java.util.List` name.

### 3. Declare invariants as a numbered list

One numbered item per invariant, each written as **the property in bold, then
why it matters**:

```mdx
1. **`0 ≤ size ≤ datos.length`.** El largo nunca es negativo y nunca supera
   la capacidad reservada. Si esta propiedad se rompe, cualquier recorrido
   sale del arreglo.
```

Two rules:

- **State the property before the consequence.** The reader has to be able to
  check the property against a picture; a sentence that opens with the
  consequence hides what is being claimed.
- **Name the one invariant that costs money, and name it last.** Every
  structure has one property that is simultaneously the source of its cheap
  operation and of its expensive one. Either close the list with it, or close
  with a paragraph right after the list — #277 uses the paragraph, because its
  expensive invariant is also the one its figure illustrates. Naming it is what
  makes the cost table of the next act readable instead of memorised.

Worked case: #277, slide _Las invariantes del arreglo_ — three invariants, and
a closing paragraph naming contiguity as both the cheap and the expensive one.

**A structure derived from another declares only what it adds.** #277's
dynamic array re-uses all three array invariants verbatim and adds exactly one
(`data.length ≤ 4 × size`). Say that the old ones are untouched, then give the
new one alone. Listing the inherited ones again reads as if they had changed —
and worse, invites restating an old invariant as if it were new, which is the
error the #277 draft made with `size ≤ data.length`. When a _rule_ changes but
its invariant does not, say exactly that: the static array kept
`size ≤ data.length` by refusing, the dynamic one keeps it by growing.

### 4. Give every operation a cost AND an invariant

The cost table has one row per operation and **at least three columns**:

```mdx
| Operación                   | Peor caso     | Invariante que restaura                         |
| --------------------------- | ------------- | ----------------------------------------------- |
| `get_at(i)`, `set_at(i, x)` | $$\Theta(1)$$ | Ninguno: no cambian `size` ni el orden          |
| `insert_at(i, x)`           | $$\Theta(N)$$ | Deja los válidos juntos desde 0, con `x` en `i` |
```

Add a **fourth column, `Amortizado`, only when some row actually differs from
its worst case** — a table whose amortised column repeats the worst case
everywhere teaches that the two words are synonyms.

The invariant column is the point of the format. It is what turns a table of
memorised numbers into a table the reader can derive: `insert_first` is
$$\Theta(N)$$ _because_ leaving the valid elements contiguous from 0 forces
$$N$$ moves.

**Write it as a bare markdown table inside the `<Slide>`** — the shape chapter
16 ships. Do **not** reach for `<PresentationWide>` to widen it. That wrapper
carries `not-prose`, which strips the Tailwind Typography styles a markdown
table depends on entirely: measured on the built site, a `td` inside it
computes `padding: 0px` against `8px` for a bare one, so the columns touch —
in the book as well as on the slide. #277 shipped exactly that defect through a
full review pipeline, because it measured slide scale and not legibility
(ADR-0067 §Addendum — #277).

If a table makes its slide shrink too far, cut columns or split the slide.

**A row CAN be colour-coded, and one row usually should be.** An earlier
version of this guide claimed the opposite; it was wrong. A markdown table
cell accepts inline JSX, so wrapping its content in a `<span style={{ color:
'var(--color-keep)', fontWeight: 700 }}>` highlights the row that the reader
should leave with — in #277's dynamic-array table, the one where the amortised
cost differs from the worst case. This passes the colour guard in
`apps/web/src/architecture.test.ts`, which matches Tailwind-shaped class names
and not CSS custom properties.

One gotcha: inline code sets its own colour, so a `<span>` wrapped around
`` `insertLast(x)` `` does nothing. Write those cells as
`<code style={{ color: 'var(--color-keep)' }}>insertLast(x)</code>` — the
element still picks up the prose monospace styling.

Colour is a second signal, never the only one. The invariant column carries
more than a colour could, and it stays.

### 5. Close on a loose end, not a summary

The last slide of the last act poses a concrete question the class has just
made askable and deliberately does not answer. Its shape:

1. Name the weakness the structure actually has, in cost terms.
2. Name the invariant that causes it.
3. Ask what happens if that invariant is given up.
4. State the trade the answer makes — what gets cheaper AND what gets more
   expensive.
5. Name the structure that makes that trade.

A promise ("veremos listas") does not qualify; the reader has to be able to
guess the answer's shape before reading it. Worked case: #277, slide _El
precio de la memoria consecutiva_ — contiguity costs $$\Theta(N)$$ at the
front, giving it up makes `insertFirst` $$\Theta(1)$$ and `getAt` no longer
$$\Theta(1)$$.

**Title the slide after the trade, not after the device.** #277's draft called
it _El cabo suelto_, which names the authoring technique and tells the reader
nothing; the shipped title names the cause. And do not end it with "es la
clase que viene" — announcing the next class is `## Lo que sigue`'s job, and
the slide is stronger closing on the trade itself.

**No forward wiki-link when the target does not exist yet.** A `[[id]]` with no
document renders visibly broken (`add-a-course-document.md` §7). Name the next
class in prose; the wiki-link arrives in the WP that writes it, from both
sides.

Then the closing navigation — a `## Lo que sigue` section or a slide of that
name (§1) — which is where the reader —
rather than the classroom — gets told what the next document covers.

### 6. Draw figures that carry their own ground

A step-by-step that does not fit a widget becomes a static SVG beside the
`.mdx`. Beyond the rules in `add-a-course-document.md` §6, this unit's figures
follow one more, and it is forced rather than stylistic:

**Every figure paints an opaque panel and draws all of its text on that
panel** — and that is a repo-wide rule, not a habit of this unit, because its
cause is that every course figure is served through `<img>`. The rule and the
arithmetic that forces it are in
[`add-a-course-document.md`](add-a-course-document.md) §6e-bis; the registered
palette with its measured pairs is in
[`../design-system.md`](../design-system.md) §"A static figure served through
`<img>`"; the decision is ADR-0026 §Addendum — #277. Follow those; this guide
adds nothing to them.

**Render every figure over both grounds and look at it.** Nothing in the build
or the suite can see a figure at all. #277 found four defects this way that no
gate could have — text clipped past the right edge, two arrows that read as
one stub, a cost line overflowing its box, and a caption that named a colour
instead of naming the thing.

**A step-by-step is a `<StepShow>`, and #277 reversed itself on this.** Its
first draft made the `insertAt` shift a listing plus a static three-panel SVG,
reasoning that a figure the whole room reads at once beats a control the
professor has to drive. The shipped class uses ten `<StepShow>` steppers
instead, because a projected figure cannot answer _when_ — the whole point of
the shift is the order the copies happen in, and a static panel makes the
reader reconstruct it. Drive the stepper in the lecture; the frames are also
readable one by one in the book.

What the frames hold is hand-written inline SVG, and `add-a-course-document.md`
§5d sanctions it in one line: "Any JSX inside a `<Step>`." Reach for
`<MemoryVisual>` when the picture is a memory diagram — it draws stack frames
and heap boxes with vertically stacked rows, and it can NOT draw a horizontal
strip of cells with index labels, braces over a sub-range, or dashed garbage
cells, so an array frame is not one of its shapes.

### 6bis. The frame vocabulary

Everything in §6 above is about a figure served through `<img>`. **A `<Step>`
frame is not one.** Inline SVG lives in the page's own DOM, so it sees
`--color-*` and must use it: no opaque panel, no hard-coded hex, never the
`#fdfbf9`/`#2b221d` values of the `<img>` exemption — those paint a
theme-blind rectangle inside a themed page. Both grounds still get looked at.

The ten steppers of #277 share one drawing vocabulary, and a second class that
invents its own makes the unit look like two courses. Copy the frame from the
slide _Operación de modificación · insertar al final_ and keep:

- **Geometry.** `viewBox="0 0 <20 + 52·n> 144"`. Cells are `48 × 44` on a
  52 px pitch from `x=10`, `y=40`. The value sits at `fontSize 17`, the index
  under it at `fontSize 11`.
- **The two braces.** Above, `data.length` in `--color-rule-strong`; below,
  `size` in `--color-ink`, spanning only the valid cells. They are what makes
  the frontier visible while it moves, and they are the reason a reader can
  see `insertLast` write outside the length before `size++` catches up.
- **A token per cell state.** Live cell: `--color-rule-strong`, solid.
  Garbage: `--color-rule`, `strokeDasharray="4 3"`, value in
  `--color-ink-faint` when it is a value nobody reads any more. Just written:
  `--color-mark` on `--color-mark-soft` — **not** `keep`, which is a status
  and says "this succeeded" (`design-system.md` §Tokens, ADR-0026 §Addendum,
  #288); #277's frames predate `mark` and still paint that state `keep`, so
  do not copy that half of them. Being moved: `--color-accent`,
  `strokeWidth 2.8`.
- **Colours go in `style={{ fill }}` / `style={{ stroke }}`**, never in a
  `fill=` attribute — an attribute cannot hold `var(--color-*)` through the
  MDX pipeline the way the style object can.
- **JSX means camelCase**: `textAnchor`, `strokeWidth`, `strokeDasharray`,
  `markerEnd`. A kebab-case attribute is silently dropped.
- **Every frame carries `role="img"` and a Spanish `aria-label`** that says
  what the caption says. Nothing in the build or the suite checks this —
  `contentRenders` enforces `alt` on `<Figure>`, not on a raw `<svg>`.

**Every `id` inside a frame is document-global.** All the frames of all the
steppers on a page live in one DOM, so a `<marker id="arrow">` repeated across
frames makes every `url(#arrow)` resolve to whichever copy comes first —
silently correct only while the definitions are identical. #277 shipped seven
`<marker id="mp">` this way and had to number them per frame. Suffix them
(`arrow1`, `arrow2`, …) and prefix them per stepper. No gate sees this.

**Keep every line of a `<StepShow>` fence under ~60 columns.** In presentation
the widget takes half the viewport and stacks code over panel; a longer line
clips at the right edge and nothing in the build or the suite sees it. Wrap
long guards BEFORE writing any `lines={[…]}` — wrapping afterwards renumbers
every step below, which is how #277 shipped two off-by-ones.

### 7. Decide widgets last, and for the unit rather than the class

Do not build a widget for one class of this unit. The structures share visual
vocabulary — cells, indices, pointers, a resize — so a widget invented for the
first class is a widget designed against one example. Sketch the animations
the whole unit wants, look for the shared pattern, and only then decide
whether to build, extend or reuse. #277 shipped zero new widgets on purpose,
reusing `<StepShow>` ten times.

**And that is where it got decided.** #288, the linked-list class, is the
unit's second data point, and it concluded that the shared shape IS real: it
writes a `SequenceStepper` with a pure trace module rather than a third class
of copy-paste frames. So a class after it does not repeat §6bis by hand —
it uses that widget, and §6bis stays as the record of what the frames looked
like when they were written out, and of the traps that come with hand-writing
them.

**Check every `<Step lines={[…]}>` against its own fence, in the browser.**
`lines` is unvalidated data: `CodeStepper` silently drops an out-of-range
number, so a wrong-but-in-range one is invisible to every gate, to the build
and to the suite. #277 shipped two off-by-ones this way — both introduced by
re-wrapping a guard onto two lines and renumbering the steps by hand — and
what found them was the cheapest possible check: **when two steppers share a
listing, their `lines` arrays must agree.** The fixed-capacity `insertAt` said
`[8, 9]` where its dynamic twin said `[7, 8]`. Print each step's lines against
its fence text and read the result next to the step's own caption.

**What that widget is, concretely** (ADR-0074): `eda` picks the structure —
array, dynamic array, or a singly / doubly / circular list — and `operation`
picks which of nine operations to animate over it. The surface never changes
between combinations, which is the point: the reader learns one visual
vocabulary and reads every structure of the unit through it, comparing COST
rather than re-reading a new widget.

So the rule for the classes that follow is no longer "decide" but **reuse
first**: a class of this unit that needs to show an operation running reaches
for `<SequenceStepper>` and adds a recipe to it (a code change, with its own
ADR — see ADR-0074 §Consequences) rather than inventing a widget of its own.
Building a new one is still legitimate, and still needs the same argument this
section asks for: what the whole unit wants, and why the existing widget
cannot carry it.

**It does not replace `<StepShow>` + `<MemoryVisual>`**, which stay the pair
for author-written pictures, whose truth is the author's (ADR-0049).
`<SequenceStepper>` DERIVES its frames from the operation, which is why it
scales to hundreds of them and why it cannot draw something the operation does
not actually do — and equally why it can only draw the structures it has
recipes for. A picture outside that set is still hand-written, under §6bis.

## The listings a class shows are code, not illustrations

A student copies what the slide prints. So a listing a class shows — in a
fence or inside a widget — **validates its arguments and names the exception
it throws**, exactly as the structure's contract says it must: an index
outside the structure is `IndexOutOfBoundsException`, an operation asked of an
empty collection is `NoSuchElementException`, a fixed-capacity insert past the
block is `IllegalStateException`. #277's Sequence card already stated the rule
in prose ("pedir fuera de ese rango es un error, no un valor"); a listing that
returns a value there contradicts the card beside it.

The same stance has a second half, and it is the one that costs something:
**a widget that cannot produce a correct listing for a combination refuses the
combination rather than drawing it.** #288's review found the circular recipe
showing the open-chain `insertFirst` — valid Java, for a structure the picture
was not drawing, breaking the ring invariant the previous slide had just
stated. The fix gave up advertised range (ADR-0074 §Amended by, the validity
matrix) rather than shipping plausible code for the wrong structure.

And the edge cases are not optional prose: the empty structure, the structure
of one, and position zero are where the general body of a method stops
working. A class that lists them on a slide owes listings that handle them.

## Checklist

- [ ] Every act heading that deserves a beat in the deck is an `h2` behind a
      `<SectionBreak />`. A break buys a title-only divider SLIDE, so it goes
      where the lecture pauses — #288 gives one to the operations act and to
      the variants act, and none to the comparison (which continues the
      argument the variants act just made) or to the exercises (which are book
      work). Deciding per act is the rule; a deviation is stated, not left to
      be read as an oversight.
- [ ] No recap act. Restating the contract and the cost tables at the end
      repeats what each act already carried; only the closing trade survives.
- [ ] **No** `<SectionBreak />` before `## Lo que sigue` — check the deck, not
      only the book.
- [ ] Every TDA introduced on ONE slide as the CREAR / CONSULTAR / MODIFICAR
      card of §2, built with inline `style` + palette tokens and closing on a
      `LO QUE NO DICE` block. No cost anywhere in it. Java's names for the
      same contract, if the class needs them, on the slide after.
- [ ] Invariants as a numbered list, property first, consequence second, and
      the expensive one named as such.
- [ ] Every operation in the cost table carries the invariant it restores,
      and the table leads with a `Molde` column grouping the operations by
      crear / consultar / modificar. An `Amortizado` column only where a row
      actually differs — and a SECOND table, for a structure derived from the
      first, may spend the invariant column's width on `Amortizado` instead,
      because the first act already taught the invariants. #277's dynamic
      array does exactly that.
- [ ] Wide tables left as bare markdown inside the `<Slide>`, never wrapped in
      `<PresentationWide>` (it strips their styling), and **looked at** on the
      slide rather than measured.
- [ ] The class closes on a named trade, not a promise, and
      no forward wiki-link to a document that does not exist.
- [ ] Every figure has an opaque panel, all text on it, a second signal beside
      colour, and was rendered over `#f8f2ef` and `#0d1117` and looked at.
- [ ] Every `<Step lines={[…]}>` read back against its own fence — counting
      from 1, blank lines included — and against the step's caption AND its
      drawing: the line lit must be the line the caption says just ran.
      `CodeStepper` drops an out-of-range number silently, so a
      wrong-but-in-range one survives the build, the suite, the preview and
      the `sr-only` live region alike. When two steppers share a listing,
      their `lines` arrays must agree.
- [ ] No new widget invented for a single class of the unit — `<SequenceStepper>`
      (ADR-0074) is the unit's widget for showing an operation run, and a class
      that needs a structure it does not draw adds a RECIPE to it, with an ADR.
- [ ] Every `<SequenceStepper>` opened in `npm run preview` and walked: the
      frames advance, the highlighted line follows the operation, the pointers
      land on the right nodes, and it reads in both themes in the book and on
      its slide. The frames and the geometry are pinned by the suite; nothing
      in the build or the suite can see the SVG.
- [ ] Every arithmetic claim about a sequence (copies, doublings, totals,
      free cells) reproduced by simulation **including one non-power-of-two
      N** — including the claims that appear only in a stepper caption or an
      `aria-label`. #277 shipped a caption saying four where its own drawing
      showed three.
- [ ] If the class carries a `<CodeEditor>` or `<Benchmark>`, its snippet RUN
      in the browser and its output quoted in the commit. Nothing in the build or the suite executes a
      snippet, and #277 shipped a bound that held for N = 16 and failed for
      N = 1000 — a value its own widget offers the reader. **There is no JVM on
      the dev host** (`java`/`javac` are the macOS stubs and fail), so the
      browser widget under `npm run preview` is the only place Java actually
      runs; do the arithmetic simulation in `python3 -c` or `node -e` instead.
- [ ] Every slide's scale measured in the deck at 1440x900, not eyeballed.
      A slide that fits is reported at scale 1.0; anything under ~0.7 is
      splitting into two titled `<Slide>`s, never a `<SectionBreak />`
      (which would add an untitled slide instead). **How to read it**: under
      `npm run build && npm run preview`, on `/nalanda/d/<id>/present?slide=<n>`,
      the scale is the `transform` on the `motion.div` inside
      `[data-testid="slide-stage"]` (`presentation/SlideDeck.tsx`) — in
      Playwright, `getComputedStyle(el).transform` and read the first number of
      the `matrix(...)`; `none` or `matrix(1, 0, 0, 1, 0, 0)` means 1.0.
- [ ] The checklists of [`add-a-course-document.md`](add-a-course-document.md)
      and [`course-content-style.md`](course-content-style.md) both pass — this
      guide adds to them and replaces neither.
