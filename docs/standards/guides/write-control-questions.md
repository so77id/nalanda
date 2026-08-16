# Write control questions

## When to read this

You are writing the questions at the end of a course document — the pool an
entrance control draws from. `add-a-course-document.md` §5e says how to type the
block; this says whether what you typed is a good question.

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
| Exactly four alternatives | The generator splits one point across them. Another number weighs differently from every other question. |
| Between one and three marked correct | None is unanswerable. All four is "mark everything", which measures nothing and collides with the *ninguna de estas* box the sheet adds to every multiple. |
| No *todas / ninguna de las anteriores* | Every copy shuffles. Out of last position they stop meaning anything. |
| No negated stem (`NO`, *excepto*, *salvo*) | Under a clock with shuffled alternatives, a negation measures hurried reading. Lowercase *no* is fine — *"¿Por qué no compila?"* is a real question, not a negated stem. |
| The correct alternative is not far longer than the rest | The most exploitable tell there is: pick the longest, be right, never study. |
| `anchor` names a real section of the document | Otherwise the question belongs to nothing and enters no control. |

## The rules nothing can check

These decide whether the control measures anything. No test will catch you.

**Answerable from its own section alone.** This is what makes "from section X to
section Y" mean anything at all. If answering needs something from three sections
back, the control silently tests material it did not announce.

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

## Checklist

- [ ] `questions:` declared in the frontmatter (`per-section`, `pool` or `none`).
- [ ] Every question has a hand-written `id`, stable across edits.
- [ ] Anchored to the section it is answerable from, or unanchored on purpose.
- [ ] Read each question against its own section, alone, and answered it.
- [ ] Each distractor is something a real student might believe.
- [ ] `npm run test` green — the mechanical rules and the coverage gate.
- [ ] Opened the document in a browser and answered the questions, both themes.
