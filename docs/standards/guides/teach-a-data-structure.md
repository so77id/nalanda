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

`content/courses/sample-course/17-edd-introduccion.mdx` — *Estructuras de
Datos · Introducción*. It establishes the vocabulary, formalises the array,
evolves it into the dynamic array, and closes on the Sequence contract. Four
acts, 27 authored slides plus four act dividers, seven static SVG figures,
zero new widgets. (Counts re-derived with
`grep -c '^<Slide title=' 17-edd-introduccion.mdx` and
`grep -c '<PresentationWide' …` — an earlier draft of this guide carried
hand-written numbers that went stale the moment slides were split.)

Its seven figures sit beside it in the same directory
(`tda-eda-invariante.svg`, `arreglo-memoria.svg`, `arreglo-invariantes.svg`,
`arreglo-corrimiento.svg`, `arreglo-duplicacion.svg`, `regla-del-cuarto.svg`,
`un-tda-dos-edas.svg`), per the asset rule in
[`add-a-course-document.md`](add-a-course-document.md) §6.

## Step-by-step

### 1. Lay out the acts

Each act is a markdown `h2` preceded by a `<SectionBreak />`, with the act's
slides inside it.

**The act table below is a hypothesis, not yet a prescription.** It is
generalised from a single class — and one that deviates from it — so it
records the four questions the unit means to answer in the same order every
time, not a mapping to `h2`s that has been observed twice. Settle the mapping
in the WP that writes the linked-list class, where a second data point makes
the shared shape visible; for now, follow it where it fits and say so where it
does not.

| Acto | Contenido |
|---|---|
| 1 | La idea — qué problema resuelve esta estructura y de qué estructura conocida se diferencia |
| 2 | Los invariantes — qué propiedades sostiene, y por qué cada una importa |
| 3 | Las operaciones y sus costos — cada una con el invariante que restaura |
| 4 | Las limitaciones y la bisagra — qué NO resuelve, y qué estructura lo resuelve |

The chapter that opens the unit deviates and says so: #277 spends act 1 on the
vocabulary itself, and runs its idea/invariantes/costos/limitaciones cycle
twice — once for the fixed array, once for the dynamic one.

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

A TDA is introduced as a **contract**, always in this order:

1. One sentence saying what the collection IS, and what orders its elements.
2. A ` ```java ` fence with an `interface`, one operation per line. Each
   operation whose meaning is not obvious from its name carries a comment
   giving that meaning — trailing where it fits, above the line where it does
   not — and **never its cost**. Shortcuts the prose defines immediately below
   may stay bare: #277 leaves the four `*First`/`*Last` uncommented for exactly
   that reason.
3. One paragraph on what the contract deliberately does **not** say (memory
   layout, capacity, growth), because that is what makes many implementations
   possible.

Costs never appear in the contract. They belong to an implementation, and
putting them here is the single mistake that collapses the TDA/EDA distinction
the unit is built on.

Worked case: #277, slide *El TDA Sequence · el contrato*.

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

Worked case: #277, slide *Los invariantes del arreglo* — three invariants, and
a closing paragraph naming contiguity as both the cheap and the expensive one.

### 4. Give every operation a cost AND an invariant

The cost table has one row per operation and **at least three columns**:

```mdx
| Operación | Peor caso | Invariante que restaura |
|---|---|---|
| `get_at(i)`, `set_at(i, x)` | $$\Theta(1)$$ | Ninguno: no cambian `size` ni el orden |
| `insert_at(i, x)` | $$\Theta(N)$$ | Deja los válidos juntos desde 0, con `x` en `i` |
```

Add a **fourth column, `Amortizado`, only when some row actually differs from
its worst case** — a table whose amortised column repeats the worst case
everywhere teaches that the two words are synonyms.

The invariant column is the point of the format. It is what turns a table of
memorised numbers into a table the reader can derive: `insert_first` is
$$\Theta(N)$$ *because* leaving the valid elements contiguous from 0 forces
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

**There is no colour coding in these tables, and that is a constraint rather
than a choice.** An MDX markdown table has no per-cell styling hook, and a raw
colour class fails `apps/web/src/architecture.test.ts` (ADR-0026, #109). The
second signal is the invariant column, which carries more than a colour could.

### 5. Close on a loose end, not a summary

The last slide of the last act is a **cabo suelto**: a concrete question the
class has just made askable and deliberately does not answer. Its shape:

1. Name the weakness the structure actually has, in cost terms.
2. Name the invariant that causes it.
3. Ask what happens if that invariant is given up.
4. State the trade the answer makes — what gets cheaper AND what gets more
   expensive.
5. Name the structure that makes it, and say it is the next class.

A promise ("veremos listas") is not a cabo suelto; the reader has to be able
to guess the answer's shape before reading it. Worked case: #277, slide *El
cabo suelto* — contiguity costs $$\Theta(N)$$ at the front, giving it up makes
`insertFirst` $$\Theta(1)$$ and `getAt` no longer $$\Theta(1)$$.

**No forward wiki-link when the target does not exist yet.** A `[[id]]` with no
document renders visibly broken (`add-a-course-document.md` §7). Name the next
class in prose; the wiki-link arrives in the WP that writes it, from both
sides.

Then `## Lo que sigue` as a book-only section, which is where the reader —
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

**A step-by-step may stay a static figure, and #277 chose that deliberately.**
The `insertAt` shift is a listing plus a three-panel SVG — the pair
`<StepShow>` exists to fuse, and `<StepShow>` is an existing widget, so reuse
would have been allowed. It was not taken because the sequence is projected in
a lecture, where a figure the whole room reads at once beats a control the
professor has to drive, and because this unit defers its widget decisions to
the point where the animations of every class are on the table (§7). Revisit
it there rather than per class.

### 7. Decide widgets last, and for the unit rather than the class

Do not build a widget for one class of this unit. The structures share visual
vocabulary — cells, indices, pointers, a resize — so a widget invented for the
first class is a widget designed against one example. Sketch the animations
the whole unit wants, look for the shared pattern, and only then decide
whether to build, extend or reuse. #277 shipped zero new widgets on purpose,
reusing `<CodeEditor>` and `<Benchmark>`.

## Checklist

- [ ] Four acts, each an `h2` behind a `<SectionBreak />`, each producing a
      title-only divider slide in the deck.
- [ ] **No** `<SectionBreak />` before `## Lo que sigue` — check the deck, not
      only the book.
- [ ] Every TDA introduced as an `interface` fence whose comments give meaning
      and never cost.
- [ ] Invariants as a numbered list, property first, consequence second, and
      the expensive one named as such.
- [ ] Every operation in the cost table carries the invariant it restores.
      An `Amortizado` column only where a row actually differs.
- [ ] Wide tables left as bare markdown inside the `<Slide>`, never wrapped in
      `<PresentationWide>` (it strips their styling), and **looked at** on the
      slide rather than measured.
- [ ] The class closes on a cabo suelto with a named trade, not a promise, and
      no forward wiki-link to a document that does not exist.
- [ ] Every figure has an opaque panel, all text on it, a second signal beside
      colour, and was rendered over `#f8f2ef` and `#0d1117` and looked at.
- [ ] No new widget invented for a single class of the unit.
- [ ] Every `<CodeEditor>` / `<Benchmark>` snippet RUN in the browser and its
      output quoted in the commit, and every arithmetic claim about a sequence
      (copies, doublings, totals) reproduced by simulation **including one
      non-power-of-two N**. Nothing in the build or the suite executes a
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
