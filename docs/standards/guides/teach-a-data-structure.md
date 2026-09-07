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
acts, 23 authored slides, seven static SVG figures, zero new widgets.

Its seven figures sit beside it in the same directory
(`tda-eda-invariante.svg`, `arreglo-memoria.svg`, `arreglo-invariantes.svg`,
`arreglo-corrimiento.svg`, `arreglo-duplicacion.svg`, `regla-del-cuarto.svg`,
`un-tda-dos-edas.svg`), per the asset rule in
[`add-a-course-document.md`](add-a-course-document.md) §6.

## Step-by-step

### 1. Lay out the acts

Each act is a markdown `h2` preceded by a `<SectionBreak />`, with the act's
slides inside it. A class about one structure runs to four acts:

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
would project the closing navigation as a slide, which is the defect #79
shipped and #108 named. Without a break, `open` is null and the closing prose
stays book-only.

### 2. Define a TDA in one shape

A TDA is introduced as a **contract**, always in this order:

1. One sentence saying what the collection IS, and what orders its elements.
2. A ` ```java ` fence with an `interface`, one operation per line, each with a
   trailing comment giving its meaning — never its cost.
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
- **Close the list with the one invariant that costs money.** Every structure
  has one property that is simultaneously the source of its cheap operation
  and of its expensive one. Naming it here is what makes the cost table of the
  next act readable instead of memorised.

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

**Write it as a bare markdown table inside the `<Slide>`.** That is the shape
chapter 16 ships and the one with evidence behind it; `<PresentationWide>`
around a table is described in `add-a-course-document.md` but exercised
nowhere in `content/`, and nothing in the build or the suite can see a table
that fails to parse.

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
panel.** An `<img>` never sees the page's tokens, so a figure paints the same
values on both grounds — and no single ink can clear the 4.5:1 text floor
against both: light `#f8f2ef` requires a relative luminance ≤ 0.160 and dark
`#0d1117` requires ≥ 0.200. The requirement is unsatisfiable, so text on the
page ground is wrong in one theme by construction. A panel of the figure's own
removes the problem.

The values #277 uses, all measured against that panel: panel `#fdfbf9` with a
`#8e817c` border, text `#2b221d` (15.1:1) and `#493d37`, accent `#3a6ea5`,
"correct" `#2f8a2f`, "wrong" `#b3261e` (6.3:1).

And, per ADR-0026, **colour is never the only signal**: dashed borders mark
casillas that hold garbage, a `✗`/`✓` marks the two rules of a comparison, and
every region carries a word.

**Render every figure over both grounds and look at it.** Nothing in the build
or the suite can see a figure at all. #277 found four defects this way that no
gate could have — text clipped past the right edge, two arrows that read as
one stub, a cost line overflowing its box, and a caption that named a colour
instead of naming the thing.

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
- [ ] Cost tables are bare markdown inside the `<Slide>`.
- [ ] The class closes on a cabo suelto with a named trade, not a promise, and
      no forward wiki-link to a document that does not exist.
- [ ] Every figure has an opaque panel, all text on it, a second signal beside
      colour, and was rendered over `#f8f2ef` and `#0d1117` and looked at.
- [ ] No new widget invented for a single class of the unit.
- [ ] The checklists of [`add-a-course-document.md`](add-a-course-document.md)
      and [`course-content-style.md`](course-content-style.md) both pass — this
      guide adds to them and replaces neither.
