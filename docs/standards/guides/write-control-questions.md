# Write control questions

## When to read this

You are writing the questions at the end of a course document — the pool an
entrance control draws from. `add-a-course-document.md` step *Write the control
questions* says how to type the block; this says whether what you typed is a good question.

Read it also before drafting questions with an agent. Every rule below carries
its reason, and that is not decoration: a rule without its reason cannot be
applied to a case it did not anticipate, and drafting always produces those.

## What a control is, and what follows from it

Four questions, five minutes, on paper, at the start of class, covering the
previous class. Every copy draws its own questions from the pool of the selected
range and shuffles the alternatives. **Every question weighs one point**, whatever
its type, and within a question each alternative decided correctly earns its
share. Nothing is ever subtracted.

Three consequences shape every rule here:

- **The student is under a clock.** A question that takes a minute to parse
  measures reading speed.
- **The alternatives are shuffled.** Anything that depends on position is broken
  before it is printed.
- **The copies differ.** Two students answer different questions for the same
  grade, so no question may be much harder than its neighbours in the same pool.

## The rules the suite enforces

Break one and `npm run test` goes red, naming the question. They are mechanical
because they are checkable — not because they matter more than the ones below.

| Rule | Why |
|---|---|
| Exactly four alternatives | Uniformity, so a sheet reads the same from question to question — NOT weighting: the reading report carries each question's `max` and the caller divides by it, so a question with three alternatives weighs exactly one point like every other (ADR-0031). |
| Between one and three marked correct | None is unanswerable. All four is "mark everything", which measures nothing: whoever knows nothing marks everything and scores. |
| No *todas las anteriores* | If every alternative is correct, mark them — that is what a multiple is. Pinning does not save this one. |
| No negated stem (`NO`, *excepto*, *salvo*) | Under a clock with shuffled alternatives, a negation measures hurried reading. Lowercase *no* is fine — *"¿Por qué no compila?"* is a real question, not a negated stem. The uppercase form is caught after a space or after `¿`. |
| The correct alternative is not far longer than the rest | The most exploitable tell there is: pick the longest, be right, never study. Compared against the SECOND longest, and switched off below 15 characters — between `123` and `No compila` the ratio means nothing, and `{3, 6, 123, No compila}` is correct authoring. |
| `id` present, kebab-case, unique across the whole `content/` tree | It is the join key from the printed sheet, through the scanner, into a grade (ADR-0031). A duplicate merges two students' answers into one column — and that one fails `npm run build`, which is the gate that must block publishing; the suite catches it too, in `content/questionBank.test.ts`. |
| A statement, and no empty alternative | A blank stem or a blank option reaches a printed, graded sheet as a question with nothing on it. |
| `anchor` names a real section of the document | Otherwise the question belongs to nothing and enters no control. |

## The rules nothing can check

These decide whether the control measures anything. No test will catch you.

**Answerable from its own section alone.** This is what makes "from section X to
section Y" mean anything at all. If answering needs something from three sections
back, the control silently tests material it did not announce.

A section runs from its `h2` to the **next `h2`** (ADR-0021), never to the end of
the `<Slide>` that opened it. So the prose, the callout or the editor that
follows a slide is still inside that section — and an `###` subsection belongs to
the `h2` above it, whole.

**Asks what the section says, not what can be inferred from it.** An entrance
control measures whether the student read the class. Reasoning problems belong in
exercises, where there is time to think and a compiler to argue with.

**One idea per question.** If the stem needs a comma and a "y además", it is two
questions.

**A short stem.** The student reads four of these in five minutes.

**A multiple because the material genuinely has several true statements** — never
to raise difficulty. If you find yourself marking a second alternative to make a
question harder, the question was too easy for a different reason.

**Distractors that a student who half-read would actually pick.** An alternative
nobody chooses is not measuring anything; it is furniture. The best distractors
are the misconceptions you have already heard in class.

## A good simple question

```mdx
<Question id="que-hace-import" anchor="import-y-paquetes">

¿Qué hace `import java.util.Scanner`?

- [x] Abrevia: al escribir `Scanner` te refieres a `java.util.Scanner`
- [ ] Pega el contenido de esa clase dentro de tu archivo
- [ ] Descarga la clase desde el paquete `java.util`
- [ ] Compila esa clase junto con tu programa

</Question>
```

Why it works: the section says exactly this and says it as the contrast with
`#include`. The second alternative **is** what `#include` does, so a student who
mapped Java onto C++ without reading picks it — which is precisely the confusion
worth catching. All four are one line. The stem is five words.

## A good multiple

```mdx
<Question id="diferencias-con-cpp" anchor="cuatro-diferencias-una-por-una">

¿Cuáles de estas afirmaciones sobre Java son ciertas?

- [x] Una clase se declara y se define en el mismo lugar
- [x] `main` no devuelve nada y el código de salida va aparte
- [ ] `System.out.println` es un operador sobrecargado como `<<`
- [ ] Una función puede existir fuera de cualquier clase

</Question>
```

Why it works: the section lists four differences, so several true statements
exist honestly — the multiple is not a device. Marking one of the two correct
ones earns its share, so partial knowledge is worth something, and ticking all
four earns less than answering carefully. Every alternative is a sentence a
student might believe.

## Three bad questions, each bad differently

### Bad because it depends on position

```mdx
¿Cuáles de estas afirmaciones son ciertas?

- [x] Java compila a bytecode
- [x] La JVM ejecuta el bytecode
- [ ] Java compila a lenguaje máquina
- [x] Todas las anteriores
```

Shuffled, *todas las anteriores* lands second and means nothing. It is also
marked correct alongside a contradiction. The suite refuses this one.

***Ninguna* de las anteriores is different, and allowed.** It says something
false out of last position for the same reason — but the printed sheet pins it
there with AMC's `\lastchoices` (ADR-0033), and it is the only way to author
the question where every option listed is wrong:

```mdx
En Java, ¿cuáles de estas expresiones dan el largo de un arreglo `a`?

- [ ] `a.size()`
- [ ] `a.length()`
- [ ] `len(a)`
- [x] Ninguna de las anteriores
```

Whoever arrives from C++ or Python marks one of the first three by reflex.
Without the catch-all the student who knows has no way to say so: leaving the
question blank is indistinguishable from not reaching it.

### Bad because the answer is the long one

```mdx
¿Qué produce `javac`?

- [x] Bytecode para la máquina virtual de Java, que después el comando `java` lee y ejecuta paso a paso
- [ ] Un ejecutable
- [ ] Código C
- [ ] Nada
```

A student who never opened the document gets this right in two seconds. The
length **is** the answer. The suite refuses this one too — but note that the fix
is not to pad the distractors: it is to shorten the answer to what it needs.

### Bad because nothing on the page can catch it

```mdx
<Question id="complejidad-hash" anchor="import-y-paquetes">

¿Cuál es la complejidad promedio de una búsqueda en una tabla de hash?

- [x] O(1)
- [ ] O(n)
- [ ] O(log n)
- [ ] O(n log n)

</Question>
```

Every mechanical rule passes: four alternatives, one marked, no negation, even
lengths, a real anchor. And it is unanswerable from the section it claims,
because that section is about `import`. A student who read the class carefully
gets it wrong, which is the exact opposite of what an entrance control is for.
**This is the failure mode to watch**, and only a human reading the section can
see it.

## Only what is on the teaching path reaches a control

A control covers a RANGE of the reading order, so a document with no position in
it — one `index.yaml` does not list — has no range to belong to, and the build
skips it when it emits the bank. Its questions would be unreachable by
definition. Write questions for a document only once it is on the path, and
declare `questions: none` on one that is deliberately off it.

## When a section owes nothing, and when one owes two

`per-section` promises a question for every section, and the gap you leave is
**declared with its reason** in `NO_QUESTION`
(`apps/web/src/content/architecture.test.ts`; the mechanics are in
`add-a-course-document.md` step 2). The set is closed in both directions: forget
a section and the gate reddens, cover one that is listed and it reddens too, so
a stale exemption cannot outlive the gap it described.

**A section owes nothing only when it teaches nothing of its own** — an activity
the student performs, a side-by-side listing whose lesson is measured elsewhere,
a closing that announces the next document, or a **contrast-anchor** opener
that names the C++ (or other prior-language) shape before the Java delta the
next section teaches. `arrays-y-funciones` inaugurated the last shape (#78,
AC-11): every Java section opens with a slide called "X en C++" whose lesson
is measured in the pregunta of the "X en Java" sibling that immediately
follows it. Same rationale as the side-by-side case: the slide's job is
context, not new material. `arrays-en-c`, `funciones-en-c`, `recursion-en-c`
and `en-c-era-segfault` are the four worked cases. Sub-detail slides — an
`h2`-level breakout of one point already made by its parent section, such as
`tres-iniciaciones` following "Arrays en Java" — sit in the same category:
the principal fact is measured in the parent's pregunta.

**"It is a hands-on slide" is not the test.** Because a section runs to the next
`h2`, what follows the editor is still inside it, and that is usually where the
teaching lives. The two Java documents differ for exactly this reason and both
are right: `java-desde-cpp` exempts its *Ejecútalo* slides, which are followed by
nothing but the next heading, while `java-tipos-y-flujo` covers its lab slides,
because the newline `nextInt()` leaves behind and the decimal point the browser's
JVM insists on are taught in the prose *after* the editor (#144).

**One section may owe two.** Coverage is counted per `h2`, so the gate is
satisfied by one — but a section that swallows an `###` subsection can hold more
material than one question can measure. `control-de-flujo` carries two for that
reason: the `###` beneath it teaches `switch`, `do-while`, `final` and the
`for-each`, and one question would have left all of that unmeasured while the
gate stayed green.

## How many, and how balanced

No maximum. A control draws four from whatever the range offers, so a bigger
pool means more variety between copies and nothing else.

There is no difficulty balancing and none is planned (design C6): an entrance
control measures whether the student read, and levelling it would hide exactly
that. What you owe instead is questions that are all *about the same thing* —
the class that was taught — so a student who read is not punished by the draw.

## Who decides

Claude drafts, the professor edits. A draft can satisfy every rule on this page
and still be wrong about what the class emphasised, and the correct answer is a
teaching judgement before it is a fact. Nothing here changes that.

## Unicode symbols

A question's statement and alternatives may use Unicode math, Greek, and dash
characters directly — the server translates them to LaTeX before the printed
sheet is compiled (see `apps/server/internal/domain/controls/tex/tex.go`,
`mapUnicodeToLatex`). The full source of truth is that table; the summary is
enough for authoring:

- Greek letters: uppercase Θ Ω Γ Δ Λ Ξ Π Σ Υ Φ Ψ and the full lowercase
  α β γ δ ε ζ η θ ι κ λ μ ν ξ π ρ σ τ υ φ χ ψ ω. Uppercase Greek that
  shares a glyph with a Latin letter (Α Β Ε Ζ Η Ι Κ Μ Ν Ο Ρ Τ Χ) and
  lowercase omicron `ο` have no LaTeX equivalent — type the Latin letter.
- Superscripts and subscripts: `⁰¹²³⁴⁵⁶⁷⁸⁹`, `₀₁₂₃₄₅₆₇₈₉`.
- Math operators: `≤ ≥ ≠ ≈ ≡ ± × ÷ · ∘ ∞ ∂ ∇`.
- Standalone symbols with no argument bound — `√ ∑ ∏ ∫`: these render
  as a bare radical / summation / product / integral glyph. An author
  who wants a rooted or indexed form writes it as `$\sqrt{n}$` /
  `$\sum_i x_i$` / etc. explicitly; the mapping does not bind arguments
  and a bare `√n` in the source prints as a radical followed by a plain
  `n` (silent-wrong-render).
- Set operators: `∈ ∉ ∪ ∩ ⊂ ⊃ ⊆ ⊇ ∅`.
- Logic: `∃ ∀`.
- Arrows: `→ ↔ ⇒ ⇐ ⇔`.
- Dashes: em-dash `—` (renders as em-dash), en-dash `–` (en-dash), true
  minus sign `−` U+2212 (plain hyphen).

Accented Spanish (`á é í ó ú ñ ü ¿ ¡`) is handled by the preamble's
`inputenc[utf8]` + `fontenc[T1]` — write it directly, no escape needed.

A character not on either list will land in pdftex verbatim; production
today refuses that compile with `auto-multiple-choice prepare failed (1)`
(issue #237). Add the character in the same PR as the question that needs
it, in two places at once (mirror is the pin against a silent revert):

1. A new pair in the `unicodeReplacer` table in
   `apps/server/internal/domain/controls/tex/tex.go` (Round 2 section).
2. A matching row in `TestMapUnicodeToLatex_Round2` in
   `tex_internal_test.go` — one `{name, in, want}` per character so a
   silent revert of the map row lands red on that row.

## Text emphasis

A question's statement and alternatives may use four MDX inline markers, and
the server translates each one to LaTeX before the printed sheet is compiled
(same pipeline as Unicode above — `escapeBankText` in
`apps/server/internal/domain/controls/tex/tex.go`).

- **Bold** — `**palabra**` renders as `\textbf{palabra}`. The double asterisks
  themselves never reach the paper; before the fix (issue #239) they printed
  verbatim around the word.
- **Italic** — `*palabra*` renders as `\textit{palabra}`. A single asterisk
  without its partner stays as a bare `*` on the sheet — pair the marker or
  omit it.
- **Code** — a backtick pair, `` `int` ``, renders as `\texttt{int}`
  (monospace). A backtick without its partner prints as a quote mark on paper
  and is not what any reader expects; pair them.
- **Quotation** — an ASCII double quote pair, `"así"`, renders as
  babel-spanish guillemets `«así»`. Straight ASCII quotes are NOT rendered
  as such: writing `"así"` on the page produces the Spanish typographic
  form, and the transform also sidesteps a `fontenc[T1]` diacritic-composition
  trap where a bare `"` before a vowel produced an unintended superscript
  glyph on paper.

Nested emphasis works in one direction: an italic inside a bold
(`**bold *italic* end**`) renders as `\textbf{bold \textit{italic} end}`
because the pipeline runs bold first. The reverse order, bold inside italic
(`*italic **bold** end*`), is undefined — bold consumes the `**` pair and
italic does not see a matching pair on either side. Author-time: pick one
kind of emphasis per span.

**Two guarantees the pipeline pins**:

- **Backticks are inviolable.** Anything the author wraps in `` `…` ``
  reaches the sheet as monospace, literally. `` `**not bold**` ``,
  `` `"María"` `` and `` `n*m*p` `` all print exactly as written inside
  `\texttt{…}` — no bold, no guillemets, no italic bleeds into a code
  fragment. Same rule MDX applies on-screen.
- **`*` between word characters is arithmetic, not emphasis.** `n*m*p`,
  `O(a*b*c*d)`, `5*3*2` and `n**m` all print with their asterisks intact.
  An emphasis marker requires whitespace or punctuation on the OUTSIDE of
  each `*`; a `*` adjacent to a letter or digit is left alone. This lets
  the complexity chapter carry `n*log(n)` in a distractor without an
  emphasis transform corrupting the expression.

Everything else that looks like a Markdown marker (headers, lists, links,
tables) is NOT supported here — statements are single-paragraph by
convention (see §"A good simple question"), and those constructs would be
neither authored today nor useful on a paper sheet. If a compile does need
raw LaTeX one day (a formula, a diagram), that opt-in is tracked as issue
#183; it is separate work from this markers set.

Round-trip is that: the online reader renders the MDX natively (bold, italic,
code, quotes read as prose on screen), and the printed sheet renders the
same intent through LaTeX. The author writes ONE source, both surfaces read
the same story.

## Post-answer explanation

`<Question>` accepts a nested `<Explanation>` block after the alternatives.
The reader sees it only AFTER answering — same pacing rule as the verdict, so
the note cannot spoil the guess. The source parser drops the block, so the
note never travels to `questions.json` and the printed sheet stays unaware:

```mdx
<Question id="for-condition-count">

En un ciclo `for (int i = 0; i < n; i++)` que hace `n` iteraciones
completas, ¿cuántas veces se evalúa la condición?

- [ ] n − 1
- [ ] n
- [x] n + 1
- [ ] 2n

<Explanation>
La condición se evalúa una vez por cada iteración que sí entra al ciclo
(n veces) más una vez extra al final para determinar que ya no se entra
— total n + 1.
</Explanation>

</Question>
```

Use it when the WHY of the answer is worth teaching — a distractor worth
naming, a subtle rule, a reference back to how the concept was framed in
class. Skip it when the correct alternative is obvious once read: an
explanation that only restates the winning option is noise. The block is
page-only, so it can hold any MDX the author needs (formulas, code, links)
without adding weight to the control artifact. Catalog entry:
[`/catalog/c/Explanation`](../../../apps/web/src/components/interactive/Explanation.catalog.tsx).

## Checklist

- [ ] `questions:` declared in the frontmatter (`per-section`, `pool` or `none`), and flipped in the SAME commit that supplies the questions and the exemptions (`add-a-course-document.md` step 2).
- [ ] Every question has a hand-written `id`, kebab-case, and not used by any other question in `content/`. Free to change until the PR merges; frozen after, because from then on it is the join key into a grade.
- [ ] Every section either carries a question or appears in `NO_QUESTION` with its reason — the exemptions are part of the work, not a gate change (`repository-structure.md` §`content/`).
- [ ] Every listing inside a question is tagged with its language (`add-a-course-document.md` §7b) — an untagged fence ships no listing at all.
- [ ] Anchored to the section it is answerable from, or unanchored on purpose.
- [ ] `<Explanation>` attached when a distractor is worth naming — appears only after the reader answers, never reaches the printed sheet.
- [ ] Read each question against its own section, alone, and answered it.
- [ ] Each distractor is something a real student might believe.
- [ ] `npm run test` green — the mechanical rules and the coverage gate.
- [ ] Opened the document in a browser and answered the questions, both themes.
