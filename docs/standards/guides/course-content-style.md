# Guide — Course content style

The voice of the course. How prose, slide titles and exercise statements are
written in every `.mdx` under `content/courses/`. Born in #80, promoted from a
per-WP rule to a repo standard after the same defect kept surfacing across
documents: informal register, regional Spanish, cross-references that pretend
the reader has just read another slide.

The mechanics of adding a document, the frontmatter contract, the slide markers
and the wiki-link syntax live in
[`add-a-course-document.md`](add-a-course-document.md) — this file is what
happens INSIDE that scaffolding: how the prose reads. Question stems have their
own home in [`write-control-questions.md`](write-control-questions.md),
because a question is a measurement and its wording rules follow from that.

## When to use

You are writing or editing course prose: any paragraph of a `.mdx` document,
the `title` of a `<Slide>`, the statement of an `<Exercise>`, the prose of a
`<PredictOutput>`. Everything the reader reads is in scope. The rules apply
equally in book mode and in presentation mode — a slide is prose that a
projector shows, not a lower register of the same document.

## 1. Voice — formal plural, inclusive

The course speaks in **first-person plural**, the voice of an author walking
beside the reader. It is the register a textbook takes when it says _analicemos_,
_veamos_, _construimos_ — the class is doing something together, and the writing
records that.

- **Preferred**: _analicemos_, _veamos_, _construimos_, _nuestra clase Pair_,
  _partimos de_, _obtenemos_. Impersonal `se` (_se declara_, _se instancia_) is
  fine too when the doer is irrelevant.
- **Avoid**: the second-person singular in any register. Both _tú escribes_ and
  _vos escribís_ are out. The reader is not addressed by a pronoun; they are
  included in the plural.

The reason is inclusion, not politeness: _tú/vos_ implies the reader has done
something specific (which they may not have), while _analicemos_ names an
activity the page and the reader do jointly. It also normalises the voice
across chapters written by different hands.

## 2. Neutral Spanish, not regional

The course is served across dialects, so the prose stays out of any single one.

- **Do not use** the voseo (_vos_, verbs in _-ás/-és/-ís_), the argentinismos
  (_acá_ for _aquí_, _laburo_, _piola_, _re-_ intensifier), the specifically
  Peninsular forms (_vale_ as an interjection, _tío_ as address).
- **Use** the neutral forms of standard Spanish: _aquí_, _ahora_, _entonces_,
  _por lo tanto_.
- Words that are the same across dialects (_computadora_ / _ordenador_ / _PC_)
  pick the most transparent option and stick with it — _computadora_ is the
  default in Latin American technical writing.

This is not a claim that any dialect is worse; it is a decision to keep the
course legible to every reader without turning any of them into a translator.

## 3. Book register, not conversation

The prose is material — it teaches — and material is precise without being
chatty. Conversation is what the professor does out loud in the classroom; the
document is what the reader keeps.

- **Avoid** the chat register: _fijate_, _mirá_, _ojo con_, _acordate_,
  _ojo_, _bueno_, _¿viste?_. These are cues a speaker gives with tone, and on
  the page they read as filler.
- **Avoid** the interpellation that assumes the reader just did something:
  _si tu programa imprimió X, viste que…_ — the reader may not have run it.
  Say what happens, not what the reader saw.
- **Use** the direct declarative: _la resta desborda_, _el compilador rechaza_,
  _al instanciar la clase, `A` queda ligado a `Integer`_.

Precise is not the same as dense. A precise sentence names one thing and lets
the reader read on; a dense sentence names five and asks the reader to
untangle them. The point is precision, not compression.

## 4. No cross-references between sections or slides

A section is written to stand on its own. It **does not** refer to another
section by number, by name, by anchor or by relative position — and neither
do the slides inside it.

- **Do not write**: _como vimos en §4_, _en la slide anterior_, _en la próxima
  sección_, _más adelante_, _ya vimos que_, _acabamos de ver_, _volveremos
  sobre esto_.
- **Do not link** from body prose to another section of the same document.
  Wiki-links (`[[otro-id]]`) are for other documents — the reading order of
  sections inside one document is a matter for the section rail, not for
  paragraphs that reach across it.
- **When a fact from an earlier section is needed**, state the fact in place.
  Repetition is cheaper than a reference the reader has to follow, and a
  self-contained section survives being read on its own — which is how the
  section is going to be read the second time a student comes back.

The `## Lo que sigue` at the end of a document is the one section that names
another document by name (via wiki-link). That is a bridge between documents,
not a cross-reference inside one.

## 5. Titles — noun phrase + optional subtitle

Every heading — the `h2` that opens a section, the `title=` of a `<Slide>`,
the `<Exercise>` title — reads as a **noun phrase** (not an imperative, not a
question, not a chatty label). When a subtitle helps disambiguate, join it
with an **interpunct** ( `·` , U+00B7):

```
{concepto central} · {precisión}
```

- **Do**: `Overflow en la resta`, `La interfaz Comparable · contrato de compareTo`,
  `Pair · A, B`, `Comparaciones seguras y desempate`.
- **Do not**: `Predecí antes de correr` (imperative), `¿Qué imprime?` (question),
  `Fix: Integer.compare + tie-breaking` (colon + English label +
  chattiness), `Un truco útil` (opinion word), `Cuando el compilador te frena`
  (assumes a scene).

The interpunct is a convention that keeps the section spine consistent — every
title is a label of the same shape, and the reader learns to skim it once and
know where they are. A single-part title is fine too when the concept is
enough on its own (_Comparator lambda_, _Ejercicios_, _Lo que sigue_).

The one place this rule bends is `## Lo que sigue`, which is a boilerplate
closing name used across every document and reads as a fixed heading rather
than a title of new material.

## 6. Where this fits with other rules

- **Frontmatter, index, slides, images, formulas, exercises, wiki-links**:
  [`add-a-course-document.md`](add-a-course-document.md) — mechanics of adding
  and shipping a document.
- **Question stems**: [`write-control-questions.md`](write-control-questions.md) —
  what a question measures and how it is worded. The voice and neutrality
  rules here apply to the stem; the questions have additional rules of their
  own about answer alternatives and formatting.
- **The suite cannot verify voice.** Nothing here fails a build or reddens a
  test — the checks are in the review pipeline and in the pre-PR walk by a
  human. The gate is authorial and editorial, not mechanical.

## Checklist

- [ ] No second-person singular anywhere. The reader appears as _nosotros_, or
      not at all.
- [ ] No voseo, no argentinismos, no Peninsular-specific words. Standard
      neutral Spanish throughout.
- [ ] No `fijate`, `mirá`, `ojo con`, `acordate`, `¿viste?`, `bueno`.
- [ ] No cross-references between sections or slides of the same document
      (grep the body for _§_, _sección anterior_, _slide anterior_, _más
      adelante_, _ya vimos_, _acabamos de_, _volveremos_).
- [ ] Every `h2` and every `<Slide title>` is a noun phrase, optionally with
      `·` and a subtitle. No imperatives, no questions, no colons + English
      labels.
- [ ] Every `<Exercise title>` is a noun phrase in the same shape.
- [ ] Read the document aloud in one pass. Anything that would come out of the
      mouth of a professor mid-lecture — an aside, a joke, a check for
      attention — is chat and comes out.
