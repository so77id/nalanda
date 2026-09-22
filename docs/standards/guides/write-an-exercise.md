# Guide — Write an exercise

The narrative shape every worked problem of the course takes. Born with #294,
whose four exercises are its worked cases.

**The shape is content, not only an authoring convention.** The course wants
the student to leave with a method for attacking a problem they have never
seen — the same method they will meet again in competitive programming and in
an interview. A method is learned by meeting it identically every time, so the
beats below are recognisable, always in the same order, and never merged for
room. A student who has read four exercises should be able to name the five
questions without being told they exist.

This is the fourth layer of the course-authoring stack, and it repeats none of
the other three:

- [`add-a-course-document.md`](add-a-course-document.md) — the **mechanics**:
  frontmatter, slide markers, figures, fences, the index.
- [`course-content-style.md`](course-content-style.md) — the **voice**.
- [`teach-a-data-structure.md`](teach-a-data-structure.md) — the **class
  shape**, and everything about figures, `<StepShow>` frames and widgets.
- **This file** — the shape of **one problem** inside any class.

Nothing here overrides the other three. When this guide needs a figure, a
widget or a fence, it points at them rather than restating them.

## When to use

Any solvable problem presented in any class of the course — any unit, whether
or not the class is about a data structure. Do not use it for the exposition
of a structure or a technique; that is `teach-a-data-structure.md`.

## Two kinds, and they differ by who does the work

- **A worked exercise** shows all five beats. Its `<Exercise>` carries the
  finished algorithm as `starter`, so the reader runs it, breaks it and plays
  with it.
- **A posed exercise** ships beat 1 and stops. Beats 2, 3 and 4 are exactly
  the work being handed to the student, so putting them on a slide would be
  answering the question. Its `<Exercise>` carries a skeleton `starter`, the
  `test` cases, and a `solution` fence.

Both are `<Exercise title="…">` with ```` ```java starter ```` and
```` ```java test ```` fences; only the posed one adds ```` ```java solution ````.
#294 ships four worked and five posed.

## The five beats

### 1. The problem

Write it as a function: the signature, what it receives, in what ranges, what
it returns. Close with solved examples — **at least one that succeeds, one
that returns the failure value, and the degenerate input** (empty, or of one
element).

**The problem's own data is statement, not implementation help.** Which symbol
closes which, what counts as a token, what the bounds are — all of it lives
here. This is the rule that stops a helper function appearing out of nowhere
in beat 4.

Say **nothing** about how it is solved. Not one word.

> **Test.** With this slide alone, could the reader take a candidate answer
> and decide whether it is correct? If not, the statement is incomplete.

**The statement arrives complete.** This course does not teach requirements
elicitation — #294 weighed it and ruled it out as more advanced than the
course's objective. The student is given a closed problem on purpose.

### 2. Why the problem is not free

Two forms are known, and either one answers the beat:

- **A tempting wrong idea and the concrete input that breaks it.** Counting
  openers and closers is right for `([])` and right for `([)]` too, and
  `([)]` is unbalanced — so what matters is not how many, it is the order.
  Recomputing each window's sum is Θ(n·k). Simulating Josefo by marking the
  dead in an array re-walks them forever.
- **The reason the problem exists**, when the difficulty is not the algorithm
  but seeing what it buys. Infix notation needs precedence rules and
  parentheses to be unambiguous; postfix needs neither. Nobody has a tempting
  wrong way to evaluate `3 4 + 2 *`, so this is the form that fits.

**A third form may appear. Classify it here when it does**, so the next author
finds it instead of re-deciding. If neither form applies, skip the beat and
say so in one line — never invent difficulty.

Why it is not optional: the class has just taught the structure, so "use a
stack" is telegraphed. The counterexample is what turns the structure from an
instruction into a conclusion the reader reaches.

### 3. The idea

Spanish and a drawing. **Zero code** — no fence, no widget, and no identifier
from the eventual listing. Name the structure **here and not before**: it is
the consequence of the idea, not its starting point.

Run the idea by hand, in prose, on beat 1's example.

> **Test.** Can it be executed by hand on that example without writing a line
> of Java? If explaining it needs a `for`, it is not the idea yet — it is
> already the implementation.

### 4. The code

**Nothing is called before it is written.** Every helper the listing uses is
written out and explained ABOVE the widget, on the same slide. This is the
defect #294's first draft shipped: `isOpener`, `isCloser` and `openerFor`
appeared inside the walk under a promise to write them "al final".

- **A helper that carries no idea says so.** It is the statement's data
  written in Java. Telling the reader where *not* to spend attention is part
  of explaining.
- **Helpers get no slide of their own.** Plumbing with a slide of its own
  reads as important.
- **The listing is the runnable exercise's listing**, character for character,
  not a paraphrase of it.
- The walk uses beat 1's example.

The widget itself, its frames and its `lines={[…]}` are governed by
`teach-a-data-structure.md` §6bis and §7.

### 5. Where it breaks, and what it costs

**Show the failure; do not list it.** A walk that fails at a visible step
beats a table of edge cases — before the code exists, "queda algo abierto" is
a claim; after it exists, it is a line that returns `false` and the reader can
see which.

- **Size it to the case.** A case that deserves a full walk gets its own
  slide; one that does not is a paragraph under beat 4.
- Cover the shapes where a general body stops working: the empty input, the
  input of one, and the first and last position.
- **The cost says why, against the structure.** "$$\Theta(N)$$, porque cada
  posición entra a la pila una vez y sale a lo más una vez" is the beat. A
  bare "$$\Theta(N)$$" is not.
- Time **and** space.
- The cost sits with the complete runnable code, where the reader has the
  whole algorithm in front of them.

## Rules that cut across every beat

- **One example.** The same input threads all five beats. The only other
  inputs allowed are beat 2's counterexample and beat 5's breaking input.
  Changing example halfway costs the reader the thread.
- **Closed vocabulary.** Nothing is used before it is defined, and nothing is
  defined in beat 4 that beat 1 or beat 3 owed.
- **Show before asserting.** No count and no cost appears before the drawing
  or the walk that produces it. #294 shipped "y de ahí salen las tres únicas
  formas de fallar" beside a figure showing three examples — a claim of
  exhaustiveness nobody proved.
- **The title says what is on the slide.** #294 shipped "La pila lo ve", which
  says nothing. The deck must be readable from its titles alone.
- **No back-references.** "la lámina anterior", "esa fila", "la columna de la
  derecha" — every slide states its own fact.

## The spine adapts

It is not carved in stone. Each problem has its own structure and they are not
all alike. A beat that does not apply is **skipped out loud**, in one line. A
beat answered in a way this guide does not list is **classified here** by the
author who met it, so the guide grows instead of being worked around.

What never moves is the **order**, because the order is the thing being
taught.

## Not a constraint

How many slides an exercise takes. It is never a goal, and never quoted as
the cost of a decision. What *is* measured is each slide's scale (floor 0.70)
and whether anything clips — recipe in `teach-a-data-structure.md`
§Checklist.

## Checklist

- [ ] Beat 1 names a function with its signature, its ranges and its return,
      and closes on solved examples including a failing one and the degenerate
      input.
- [ ] Beat 1 contains no word about the solution, and carries the problem's
      own data (pairs, tokens, bounds).
- [ ] Beat 2 gives a counterexample **or** the problem's reason to exist — or
      is skipped in one explicit line.
- [ ] Beat 3 contains no code and no identifier from the listing, and the
      structure is named there for the first time.
- [ ] Every helper the listing calls is written and explained above the
      widget, on the same slide, and none has a slide of its own.
- [ ] The listing on the slide and the listing in the `<Exercise>` are the
      same characters.
- [ ] One example threads beats 1, 3 and 4.
- [ ] Beat 5 SHOWS a failure, covers empty / one / the extremes, and states
      time and space cost each with its reason.
- [ ] Every slide title says what is on its slide, and no slide refers to
      another one.
- [ ] The `<Exercise>` runs in `npm run preview` against the real JVM and its
      `test` fence passes — nothing in the build or the suite executes Java.
- [ ] The checklists of [`add-a-course-document.md`](add-a-course-document.md),
      [`course-content-style.md`](course-content-style.md) and
      [`teach-a-data-structure.md`](teach-a-data-structure.md) all pass — this
      guide adds to them and replaces none.

## Worked cases

`content/courses/sample-course/19-edd-stack-queue.mdx` — four worked exercises
(paréntesis balanceados, notación polaca inversa, el problema de Josefo,
promedio móvil) and five posed ones. The guide was written from them and
they are rewritten to it in the same WP — notación polaca is what produced
the second form of beat 2, having no tempting wrong idea to offer.

**Its sibling for the question bank already exists**:
[`write-control-questions.md`](write-control-questions.md) governs the
questions at the end of a document. An exercise and a question are different
objects — one is solved, the other is answered — so neither guide defers to
the other.
