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

## Three kinds, and they differ by who does the work

- **A worked exercise** shows all five beats. Its `<Exercise>` carries the
  finished algorithm as `starter`, so the reader runs it, breaks it and plays
  with it.
- **A posed exercise** ships beat 1 and stops. Beats 2, 3 and 4 are exactly
  the work being handed to the student, so putting them on a slide would be
  answering the question. Its `<Exercise>` carries a skeleton `starter`, the
  `test` cases, and a `solution` fence.
- **An exercise solved in the book** ships the statement and the program that
  solves it, and no slide: its `<Exercise>` carries the finished program as
  `starter` and the `test` cases, with no `solution` (the third kind, below).

**And they differ in where the runnable block lives.** A worked exercise's
`<Exercise>` goes INSIDE a `<Slide>`, wrapped in `<PresentationWide>`, because
the lecture ends on "here is the whole thing, run it". A posed one stays
book-only: a problem nobody has solved yet is not something a room reads off a
projector. #294's four worked exercises are the first `<Exercise>`s in the
course to ship on slides; the twelve before them were all book-only, and
#294's own acceptance criteria forbade it before the slide-by-slide review
reversed the call.

All three are `<Exercise title="…">` with ```` ```java starter ```` and
```` ```java test ```` fences; only the posed one adds ```` ```java solution ````.
#294 ships four worked and no posed ones — its five were cut. The posed
shape is not hypothetical, though: eleven of them already ship, six in
`16-diseno-algoritmos-ordenamiento.mdx` and five in
`18-edd-listas-enlazadas.mdx`, all with a statement, a skeleton `starter`,
`test` cases and a `solution`, and none of them on a slide.

**A worked exercise's program goes on its slide whatever its length.** An
`<Exercise>` on a slide shows its whole `starter`, uncapped, and the slide
scales to fit it — up to 32 lines (`SLIDE_LINES` in `Exercise.tsx`), which
covers every program #294 and #304 put on slides (the longest is 31). A
longer one shows a window of 32 lines that scrolls, on the slide only; the
book still shows it whole. Shown whole on a slide, #321's calculator — tree,
traversal and stack evaluation chained, about eighty lines — scaled to 0.34
against the 0.70 floor, and a program of 38 to 0.62; with the window both
slides sit at 0.74. Until #321 such a program stayed book-only, which left
the lecture without the slide where the room runs it.

**They are a SECOND posed shape, and it is worth naming.** The eleven do not
"ship beat 1 and stop": every one hands the reader beat 3 inside the
statement — «recorrerla con dos referencias a distinta velocidad», «usá
`partition`, esquema Lomuto», «empezar con un nodo de mentira» — and several
hand over beat 2 and beat 5 as well. #288 says so outright: _"Cada enunciado
dice dónde está la dificultad."_ Call that shape **guided**: the idea is
given and the writing is the work. The bare shape above — beat 1 and nothing
else — is what a control or an exam asks for. Both are legitimate; what is
not legitimate is drifting between them inside one bank, because the reader
cannot tell how much thinking is expected of them.

**The third kind: solved in the book.** A statement and the program that
solves it, book-only, with no beat on a slide: the `<Exercise>` carries the
finished program as `starter`, the `test` cases, and no `solution`. It is for
a problem whose walk the class already gives — its idea and its code are the
theory's own — so working it on slides would show the room the same thing
twice, while the runnable program still earns its place in the book. #350
moved two exercises there in Miguel's review (2026-11-03): the grades grouped
by student, once the Map's grouping slides walked the same code, and the
`Rut`'s `equals` and `hashCode`, which the key act builds step by step.

## The five beats

### 1. The problem

**Four movements, and the signature is the last of them.**

1. **What the problem is**, in one or two sentences, with something that
   already has it — an editor marking an unclosed bracket in red.
2. **What the hard word means**, drawn. "In the correct order" is a phrase
   the reader can nod at and not be able to check; the arcs between each pair
   make it checkable.
3. **What the program receives and what it has to answer**, in Spanish.
4. **The signature**, which is movement 3 written in Java, followed by the
   ranges.

**The signature is derived, not declared.** Opening on
`boolean isBalanced(String s)` hands the reader an API and no problem — the
version of this guide that said "write it as a function: the signature, what
it receives…" produced exactly that, and it read as a specification landing
from nowhere.

**Close with solved examples** — at least one that succeeds, one that returns
the failure value, and the degenerate input (empty, or of one element). **A
figure that shows those examples with their verdicts IS the examples**: do
not also table them, and do not narrate the figure back in prose. #294 wrote
"`({[]})` devuelve `true`; las otras tres, `false`" under a figure whose own
labels already said it.

**The problem's own data is statement, not implementation help.** Which symbol
closes which, what counts as a token, what the bounds are — all of it lives
here, and so does the name of the size the costs will be quoted against
(`N` is the length of `s`). This is the rule that stops a helper function
appearing out of nowhere in beat 4.

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

**The counterexample breaks the idea on the input it draws.** #350's window
drew the minimum leaving on the running example (5 3 3 8 6 2, windows of
three), where another 3 stays: the tempting variable answered every row
right, and the slide showed nothing break. A separate input does it now —
2 5 6 with windows of two, where the variable still answers 2 after the 2
has left. Beat 2's counterexample is the one input besides the running
example that the rule below allows.

**Check the statement against every tool the course has taught, not only
the one the class just did.** #350's first agenda kept its times as `HHMM`
within one day: at most 1440 keys, the direct-access case Tablas Hash teaches
with its cloakroom, and a `boolean[2400]` passed every test while beat 2
claimed that no array books in less than Θ(N). Its posed «next departure»
had fixed departures, which a sorted array and a binary search answer as
well as the tree; its «nearest event» built the tree on every call and lost
to the scan it claimed to beat. A bounded integer key admits direct
addressing, data that never changes admits sorting once, and a structure
built per query pays its construction every time. The review rewrote all
three: instants with no last day, departures that change, a dictionary
that lasts between queries.

Why it is not optional: the class has just taught the structure, so "use a
stack" is telegraphed. The counterexample is what turns the structure from an
instruction into a conclusion the reader reaches.

### 3. The idea

Spanish and a drawing. **Zero code** — no fence, no widget, and no identifier
from the eventual listing. Name the structure **here and not before**: it is
the consequence of the idea, not its starting point — **and that includes the
slide's title**, which the reader meets first of all. #294 titled this beat
`La pila de símbolos pendientes` and answered, in the title, the question beat
2 had just opened.

**The argument has to be an argument.** Deriving the stack from "two arcs
cannot cross" is circular: not crossing is what balanced MEANS, so the
sentence assumes what it is explaining. What works is unpacking the
definition into an order: a symbol opened later is nested inside the one
before it, and nothing can close while something is still open inside it —
so a closer can only match the most recent.

Run the idea by hand on beat 1's example — **in a drawing**, one state per
step, with the values written in the drawing and its caption. The prose
states the rule and names no values (the class-wide rule is
[`course-content-style.md`](course-content-style.md) §4c). #304's _El peor de los K mejores_ says
in prose what happens to each number that arrives, and the `<TopKStrip>`
under it runs `5 1 9 3 7 2 8` through the K best so far, the worst on top;
the min-heap is named only after it. The rule came out of the
professor's review of #304: concrete values («el 9», `data[8]`) appear only in
drawings and their captions, never as «insertemos un 9…» in the prose.
Six such strips — one column per state — are file-local copies across three
classes, and the next one is not a seventh: the document that wants one
promotes `<HandRun>` and moves the six onto it
([`add-a-course-document.md`](add-a-course-document.md) §6e-quater).
An idea with several parts gets several pictures, one per part.

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
  of explaining. **A helper that HIDES the idea is inlined instead**: #304's
  first merge of K lists called a `push` helper, and the review removed it,
  because the `null` check written where it is used reads better than a call
  that hides it.
- **A listing whose idea has several moving parts is built in pieces before
  the full walk.** One slide per fragment — the few lines it adds and a
  drawing of what they do — and only then the whole listing, walked. #304
  builds its merge on four slides (_K listas · los primeros frentes_, _sacar
  el menor_, _enganchar el siguiente_, _una vuelta_) before _K listas · la
  solución_; «the idea, then the whole listing» is what the review
  rejected.
- **The pieces are not walked apart when they are one class.** #322's
  iterator first walked its constructor on one slide and `next` on the
  next, and the professor rejected it: «es como el widget partido». The
  methods call each other — the constructor and `next` both run `pushLeft`
  — so the walk is the whole class in one widget, from the construction to
  the last `next`, with the drawing `beside` the listing when the class is
  too long to stack over it (`teach-a-data-structure.md` §6bis). Building
  in pieces is for a listing whose parts are steps of one algorithm, as
  #304's merge; a class whose parts are methods is walked whole.
- **Unless the class does not fit and its methods call nothing of each
  other.** #350's enrollments — a constructor and four methods, 42 lines —
  walked whole beside its drawing measured 0.563 against the 0.70 floor.
  Its methods share a field and call nothing of each other, so it walks the
  constructor and `enroll` on one slide (0.769, the rest of the class a
  one-line comment) and `drop`, `count` and `roster` stacked on the next
  (0.775). The iterator's rule stands where methods call each other.
- **A helper slide comes immediately before the listing slide** when the
  helpers and the walk do not fit together. This guide said the opposite
  first — "helpers get no slide of their own, plumbing with a slide of its
  own reads as important" — and both exercises of #294 that have helpers
  broke it, because on one slide the two clip. `course-content-style.md` §5,
  written in the same PR, then sanctioned the resulting run of titles by name
  as a legitimate series. The document was right and the rule was wrong.
- **The listing is the runnable exercise's listing**, character for character,
  not a paraphrase of it.
- The walk uses beat 1's example.
- **What the widget says when driven does not count as said.** A step note
  is read only by someone who advances to that step — in a lecture, only if
  the professor stops there. #294's two-pops slide put its whole point
  ("the first pop returns the right operand, because it entered last") in a
  step note and nowhere in the prose, and the slide read as an assertion
  about two lines it never named. The central fact goes in the prose; the
  widget shows it happening.

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
- **The cost goes with the failure analysis, not with the runnable code.**
  This guide said the opposite before anyone measured it: an `<Exercise>`
  slide is mostly editor, and #294's carried the cost paragraph at scale
  0.689 — below the floor. Beat 5 is one beat, so keeping its two halves
  together is also the truer shape. The runnable slide keeps only what the
  reader needs in order to press the button.

## Rules that cut across every beat

- **One example.** The same input threads all five beats. The only other
  inputs allowed are beat 2's counterexample and beat 5's breaking input.
  Changing example halfway costs the reader the thread.
- **Closed vocabulary.** Nothing is used before it is defined, and nothing is
  defined in beat 4 that beat 1 or beat 3 owed.
- **Name the input you are talking about.** "Las dos expresiones", "el
  recorrido se detiene en el tercer carácter" — the reader has to look at the
  figure to find out which input that is. Write `([)]` — in the figure's
  caption or label when the run lives in a drawing (beat 3).
- **Show before asserting.** No count and no cost appears before the drawing
  or the walk that produces it. #294 shipped "y de ahí salen las tres únicas
  formas de fallar" beside a figure showing three examples — a claim of
  exhaustiveness nobody proved.
- **The title says what is on the slide**, and **no slide refers to another
  one**. Both rules and their worked cases live in
  [`course-content-style.md`](course-content-style.md) §5 and §4; they are
  named here only because a beat's title is the place an exercise breaks them
  first — see beat 3, where the title is part of not naming the structure
  early.

## A class's worked exercises

**They climb in difficulty, and the levels are never shown.** A class that
works several exercises on its slides orders them easy, medium, hard — that
is how the author picks them and the order they run in — and no title,
caption, slide or index says «fácil», «medio» or «difícil»: the levels are
the author's tool, not the reader's. #304 works three, a planner, Top-K and
the merge of K sorted lists, and goes straight from the last cost slide to
the first problem, with no slide announcing how many follow.

## The spine adapts

It is not carved in stone. Each problem has its own structure and they are not
all alike. A beat that does not apply is **skipped out loud**, in one line. A
beat answered in a way this guide does not list is **classified here** by the
author who met it, so the guide grows instead of being worked around.

What never moves is the **order**, because the order is the thing being
taught.

**A graph exercise follows its own protocol**, below: the five beats are
still there, in order, but the model grows into a part of its own and the
statement changes shape.

## A graph exercise: the protocol

Written with Miguel while rebuilding «Sugerir amigos» of
`26-grafos-tda-modelado.mdx` (#363, 2026-11-08/09), which is its worked case.
It does not fix slides: it fixes **the questions the exercise answers, in
this order**. A question may take one slide, several, or share one; what
matters is that each answer is understood. The method is what is being
taught — take a problem that does not speak of graphs, model it, decide how
to store it, and only then solve it — and it is learned by meeting it the
same way every time, the same way the student will meet it in a test.

### Before writing

Prepared off the slides:

1. **The problem**, told without the word «grafo»: a network, a map, a grid,
   a game.
2. **Its exact input and output**: the method's signature, each parameter
   with its bounds, and the full output rule (ties, the case with no answer).
3. **One small example**, about five vertices, that has an answer. The whole
   exercise uses it.
4. **The cases with no answer**, one or two, small.
5. **The naive solution and its cost** under the statement's bounds, and
   **the idea** that improves on it.
6. **The program and its tests**, with one test per rule the statement
   states (the tie, the case with no answer).

### The questions, in order

Three parts: **the statement**, **modelling** and **solving**.

**A · The statement**

- **A1. What is asked?** The full statement, as in a test: one or two
  sentences of context; **the question in bold** with its complete rule; the
  hard word defined in the text, in its own paragraph; **Implemente** with the
  signature quoted from the file; **Entrada:** with one bullet per parameter
  (what it is, how it comes, its bounds); **Salida:**. The text takes the
  slide's full width (`measure-full`). *Test:* could a student write the method
  from this alone, in a test? It says nothing about how to solve it, and no
  drawing gives the answer away.
- **A2. What should it return?** The example: the input exactly as it reaches
  the method (one box per parameter) and the expected output in a «retorna»
  box. *Test:* it does not say why — that is B2's.

**B · Modelling**

- **B1. What is each thing in the graph?** Four decisions — what a vertex is,
  what an edge is, whether it has direction, whether it has weight — in a
  table **Pregunta · Respuesta · Por qué**. Direction and weight answer with
  their names (**no dirigido / dirigido**, **no ponderado / ponderado**). The
  example's input stands beside the graph it becomes.
- **B2. Why does the example return that?** The question translated into the
  graph's words, the hard word first («un amigo en común es un **vecino que
  comparten**»), and the example's output **seen on the drawing**, one step
  per drawing. This is the first place the answer is explained. It closes by
  saying whether an operation of the contract answers it or it needs a walk.
- **B3. How big can the graph be?** Four steps, each with **the rule, the
  formula, the numbers substituted and the result**: the edges (what the
  statement bounds is used as given); the vertices (where their bound comes
  from — V ≤ 2E for an edge list — with a drawing of the worst case); the
  edges there could be (where the formula comes from, and the computation on
  a line of its own); dense or sparse (what there is over what there could
  be, and what that means in words). *Test:* the student could repeat every
  computation in another exercise.
- **B4. Where is it stored?** What each structure would cost with those
  numbers — the memory with its computation, and what the operation the
  question uses walks over — in a Matriz · Listas table with the cheaper one
  in green; then the summary table of B3 and **the decision** in bold: which
  class, how much it takes, what that operation costs. If the input already
  **is** an adjacency matrix, it is used as given and B4 says why converting
  it would cost more. If the graph could be **implicit** — the input or a rule
  already says who neighbours whom — B4 still decides how it would be stored
  («la decisión, si se guarda») and closes on whether storing it is needed at
  all: C1 then measures storing it, and C2 is the implicit graph that does not.
- **B5. How does the input become the graph?** Only when it has to be built:
  each translation the program needs, with **its use in the algorithm**, and
  why the input is read as many times as it is, explained before any code;
  then the walk that builds the graph, whose frame keeps **the same size from
  its first step** — what does not exist yet holds its space, empty.

**C · Solving**

- **C1. What is the direct way, and what does it cost?** The naive solution
  — the question followed to the letter — drawn with its count on the
  example, and its cost: the formula and the computation with B3's numbers.
  It closes in two paragraphs: «**El tiempo es O(…).** Con … pasos, a unos 10⁸
  por segundo, tarda …» and, on its own, «**¿Se puede hacer mejor?**». This
  is beat 2 of the five, in the form a graph exercise takes.
- **C2. How is it done better?** The idea, opening on «Para hacerlo mejor,
  …», in numbered steps each led by its observation in bold, with drawings of
  the run on the example marking what adds up or changes. The auxiliary
  structures are named here. No code.
- **C3. What does it look like in code?** The solution's walk on the
  example, with a one- or two-line introduction; variables under the code,
  the graph, lists and arrays in the drawing; helpers written before use.
- **C4. Where does it fail, and what does it cost?** The cases with no
  answer, **drawn**; **Tiempo** part by part, one bullet per part with its
  cost and its reason; **En total** in a paragraph of its own, compared in
  seconds with C1; **Memoria**.
- **C5. The whole program**, to run: the `<Exercise>` and its tests.

### Rules across the exercise

- **One example** from start to end; only the cases with no answer use other
  inputs.
- **No storage structure is drawn before B4.** Until the structure is
  decided, the input is shown as it arrives — as text, even when it is a
  `boolean[][]` — and the model as a graph; the matrix or lists drawing
  appears first in B4, where it is chosen. Miguel, on the celebrity
  (2026-11-10): «la matriz debería aparecer cuando se dice: ok, lo haremos
  con matriz».
- **The example's output is given in A2 and explained in B2.** Nothing before
  the model explains it.
- **Before the model, the problem's words** (amigo, persona); **from the model
  on, the graph's** (vecino, vértice).
- **No number appears without its construction.**
- **A drawing to explain, a table to summarise.**
- **One idea per slide.** A crowded slide is split, never shrunk.
- **No slide names another**, and every title says what is on its slide:
  `‹Problema›` and `‹Problema› · ‹what it answers›`.
- **Mathematics in LaTeX**, and a long computation on a line of its own.

### Checklist

- [ ] A1 works as a test statement and says nothing of the solution.
- [ ] A2 gives the example's output and does not explain it.
- [ ] B1's four decisions each have a reason, with the input beside its graph.
- [ ] B2 explains the output on the graph and says whether the contract is
      enough.
- [ ] Every number of B3 has its rule, formula and substitution.
- [ ] B4's decision comes from comparing costs with those numbers.
- [ ] B5 says what each translation is for, and its walk's frame is fixed.
- [ ] C1 is measured in seconds and ends on «¿se puede hacer mejor?».
- [ ] C2 is in steps, with drawings and no code.
- [ ] C4 draws the cases with no answer, and its time goes part by part with
      the total compared.
- [ ] C5 passes its tests against the real JVM.

**What this changes in the five beats, for graphs only:** the statement no
longer closes on solved examples — it gives one with its output, explained in
B2, and the cases with no answer go to C4; the model is a whole part, B1–B5;
and beat 2 is the measured naive solution, C1.

## Not a constraint

How many slides an exercise takes. It is never a goal, and never quoted as
the cost of a decision. What *is* measured is each slide's scale (floor 0.70)
and whether anything clips — the scale recipe is in
`teach-a-data-structure.md` §Checklist and the clipping one in §6bis.

## Checklist

- [ ] Beat 1 names a function with its signature, its ranges and its return,
      and closes on solved examples including a failing one and the degenerate
      input.
- [ ] An exercise solved in the book carries beat 1 and the program that
      solves it as `starter`, with `test` cases that pass against it; it
      owes no slide and no `solution` fence, and the items for beats 2 to 5
      below do not apply to it (§Three kinds).
- [ ] Beat 1 contains no word about the solution, and carries the problem's
      own data (pairs, tokens, bounds).
- [ ] Beat 2 gives a counterexample **or** the problem's reason to exist — or
      is skipped in one explicit line.
- [ ] Beat 2's counterexample breaks the tempting idea on the input it
      draws, and no tool already taught — direct addressing for a bounded
      key, sorting once for data that never changes — solves the problem as
      well as the one the exercise teaches.
- [ ] Beat 3 contains no code and no identifier from the listing, and the
      structure is named there for the first time.
- [ ] Beat 3's hand run is a drawing, with the values in it and in its
      caption; the prose states the rule and names none. One drawn as a
      column per state promotes `<HandRun>`, or uses it once it exists —
      never a seventh file-local strip (`add-a-course-document.md`
      §6e-quater).
- [ ] A listing whose parts are steps of one algorithm is built a
      fragment per slide before the full walk; a class whose methods call
      each other is walked whole in one widget, `beside` its drawing when it
      does not stack (§4); and a helper that hides the idea is inlined.
- [ ] The worked exercises of a class climb easy → medium → hard, and
      nothing the reader sees names a level or counts the problems.
- [ ] Every helper the listing calls is written and explained before the
      walk that calls it — above the widget when both fit on one slide, on
      the slide immediately before it when they do not.
- [ ] The listing on the slide and the listing in the `<Exercise>` are the
      same characters.
- [ ] One example threads beats 1, 3 and 4.
- [ ] Beat 5 SHOWS a failure, covers empty / one / the extremes, and states
      time and space cost each with its reason.
- [ ] Every slide title says what is on its slide, and no slide refers to
      another one.
- [ ] The `<Exercise>` runs in `npm run preview` against the real JVM and its
      `test` fence passes — nothing in the build or the suite executes Java.
- [ ] Each rule the statement states — a tie-break, a duplicate refused, a
      capacity, a boundary — has a test case that only that rule decides, and
      the tempting wrong version (the rule dropped, `<` for `<=`) fails it.
      #352's review found two that passed: an enrollment whose duplicate the
      capacity refused first, and a tie the `HashMap`'s order happened to
      break the right way.
- [ ] The checklists of [`add-a-course-document.md`](add-a-course-document.md),
      [`course-content-style.md`](course-content-style.md) and
      [`teach-a-data-structure.md`](teach-a-data-structure.md) all pass — this
      guide adds to them and replaces none.

## Worked cases

`content/courses/sample-course/19-edd-stack-queue.mdx` — four worked exercises
(paréntesis balanceados, notación polaca inversa, el problema de Josefo,
promedio móvil). The guide was written from them and
they are rewritten to it in the same WP — notación polaca is what produced
the second form of beat 2, having no tempting wrong idea to offer.

`content/courses/sample-course/20-edd-priority-queue-heap.mdx` — three worked
exercises (un planificador de tareas, Top-K, mezclar K listas ordenadas) and
one posed (la verificación de un max-heap). They added beat 3's run in a
drawing, beat 4's listing built in pieces, the inlined helper, and the
hidden difficulty levels.

`content/courses/sample-course/21-edd-arboles-i.mdx` — three worked exercises
(el espejo de un árbol, el nivel más ancho, una calculadora con paréntesis)
and two posed (las rutas de los archivos, las carpetas grandes). Two of them
carry the first programs longer than a slide shows whole — the widest level
(38 lines) and the calculator (83) — each on its slide in a window of 32
lines.

`content/courses/sample-course/22-edd-arboles-ii.mdx` — three worked
exercises (el ancestro común más bajo, un iterador para el árbol de
búsqueda, la intersección de dos árboles de búsqueda) and three posed (el
problema de Josefo con saltos grandes, un árbol de búsqueda de altura
mínima, la verificación de un árbol de búsqueda). They added the class
walked whole — the iterator's constructor, `pushLeft`, `hasNext` and `next`
in one widget `beside` its tree and stack, after the professor rejected it
split across two slides — and beat 3's hand runs drawn as one column per
state (the pending stack after every `next`, the two inorders crossed one
comparison at a time), the shape the heap class's Top-K strip set — six
copies of it now, which the next strip promotes.

`content/courses/sample-course/24-edd-set-map.mdx` — four worked exercises
(el primer voto repetido, una agenda de horas con separación mínima, el
mínimo y el máximo de una ventana de precios, las inscripciones de un
semestre), two solved in the book only
(las notas de cada estudiante, votantes distintos con y sin puntos — the
third kind above) and three posed (el conteo de votos, la próxima salida, el
evento más cercano), across the four classes it teaches: `HashSet`,
`HashMap`, `TreeSet`, `TreeMap`. The posed ones are guided, and one of them is
a key of its own: the dates of the nearest event are a `Day` whose `compareTo`
the student writes, and `Day.daysBetween` is given. The window's
beat 2 takes both forms on two slides — recomputing each window is slow,
keeping the minimum in a variable is wrong the moment it leaves — and its
listing is built in pieces before the walk, as #304's merge was. The
agenda's walk is a 29-line class `beside` a column of its times in order
(`AgendaColumn`): a day drawn as an axis was unreadable in half a slide.

The enrollments are the exam-shaped one Miguel asked for: a problem that
ends in writing a key class with its `equals` and `hashCode`, as a written
control asks. Its beat 2 takes both forms — a list of pairs is slow, and the
course code alone as the key merges two sections — and its beat 4 first
shows the key failing on a plain `HashMap` (two equal sections, two keys)
before `Section` writes its two methods; `Rut` is given, the theory's own,
and orders each section's roster.

Miguel's review of the first draft (2026-11-01) rewrote four of the eight,
and two rules above come from it: the counterexample that has to break the
idea on the input it shows (beat 2), and the statement checked against
every tool already taught (beat 2).

`content/courses/sample-course/26-grafos-tda-modelado.mdx` — five worked
exercises (sugerir amigos, una celebridad en la red, la ciudad vecina más
cercana, los callejones sin salida de un laberinto, los giros de un candado)
and three posed (los seguidores de cada persona, un solo trazo y desde
dónde, los estados vecinos de dos jarras). They added the model beat above,
and they climb by input rather than by algorithm: names to numbers, an
adjacency matrix given as such, weighted edges, a grid whose graph is never
stored, and no input at all — a graph that is only a rule. None of them
traverses the graph; that is the next class's. All five were rebuilt on the
graph-exercise protocol above (2026-11-09), «Sugerir amigos» first and with
Miguel, slide by slide; the other four show its adaptations — an input that
already is the adjacency matrix (the celebrity), weights (the nearest city),
and two implicit graphs (the maze, the lock), where C1 measures storing
the graph — memory, or work wasted generating it — and C2 does not store it.
An adversarial review of the four (2026-11-09) settled that shape: a B4 that
already decides «no se guarda» leaves C1 measuring a choice the exercise has
just ruled out.

**Its sibling for the question bank already exists**:
[`write-control-questions.md`](write-control-questions.md) governs the
questions at the end of a document. An exercise and a question are different
objects — one is solved, the other is answered — so neither guide defers to
the other.
