# ADR-0033: The printed sheet is a contract too

**Status:** Accepted
**Date:** 2026-08-16
**Decision-makers:** Miguel Rodriguez
**Source:** #147 review — the sheet's rules were living in a fixture's comments

## Context

ADR-0031 owns what comes back from a scanned sheet. ADR-0032 owns the published
question bank. Nothing owned **the sheet itself** — what a student is handed and
reads under a five-minute clock.

That gap was not theoretical. Every rule below was found by compiling a sheet
and looking at the rendered page, and each one had already produced a sheet that
said something false or refused to build:

- The sheet told every student *"Marca una sola alternativa por pregunta"* while
  the pool contained a question with two correct answers.
- *"Ninguna de las anteriores"* printed **second**, above two of the
  alternatives it claims to be talking about, because alternatives shuffle.
- A question carrying code compiled only because the random draw did not pick
  it; on the day it was drawn, the control would not have built at all.

None of those is visible to a test that reads a database. They are visible on
paper, and the rules that prevent them belong somewhere binding rather than in
the comments of `tests/fixtures/control-demo.tex`.

## Decision

**A printed control sheet is a contract with the student, and these are its
terms.** WP-E generates sheets that honour them; the fixture is the worked
example and the suite asserts them against the rendered PDF.

### Every question states, in words, how many answers it admits

*(una respuesta)* or *(varias respuestas)*, on every question, of both kinds —
never a symbol with a legend. A legend is read once at the top and forgotten by
question three, and a student who cannot scroll back has no way to recover the
convention.

It takes two different levers and the asymmetry looks like a bug the first time
it is met: a simple question takes the label as its optional argument, and a
multiple-answer one cannot, because the engine's own definition already passes
its label into that same slot. Redefining that label macro is the way in.

### The sheet carries its own arithmetic

A header block states the instructions, how many questions the sheet holds, what
they are worth in total, and **the score at which the 4,0 falls — computed for
that sheet**. Nobody should do a rule of three under a clock. WP-E computes those
numbers per generated control; they are not a constant.

It also says that answering everything is free, which is true and follows from
§C7: nothing is ever subtracted.

### An alternative whose wording refers to the others is pinned last

*"Ninguna de las anteriores"* is an ordinary authored alternative — the engine's
own appended box is off (ADR-0031) — and it is pinned to the end of the list
while the rest shuffle. Unpinned it is not merely useless: it is **false**, since
"the previous ones" then names alternatives printed below it.

This is what makes the question where every listed option is wrong authorable at
all. Without it the student who knows has no way to say so, because leaving the
question blank is indistinguishable from not reaching it.

### Anything the source reads is staged under `/work` and referenced absolutely

Code in a question arrives from a file. A path relative to the `.tex` does not
resolve — the engine compiles from its own working directory — and the failure
is fatal with no PDF produced, not a missing listing.

## Alternatives considered

- **A symbol per question plus a legend at the top.** Cheaper in ink. Rejected:
  the legend is read once and the symbol is met three questions later.
- **The engine's own appended "none of these" box.** Rejected in ADR-0031 for
  its own reasons — all-or-nothing, wrong Spanish we cannot correct per
  question, and 0-based numbering for one question type only.
- **Leaving the rules in the fixture's comments.** What this ADR replaces. The
  fixture is where they are *demonstrated*; a generator author reads a
  standard, not somebody else's test data.

## Consequences

- **WP-E owns the header block's numbers.** They are computed per control from
  the questions drawn, not copied from the fixture.
- **The question bank must be able to declare what the sheet needs** (#139,
  ADR-0032): a question's type, an alternative that is pinned last, and code as
  its own field so nothing needs escaping. Until the bank can express the pin,
  `docs/standards/guides/write-control-questions.md` is the place that says so.
- **`apps/amc-worker/README.md` §What a control source must contain stays** as
  the operational how-to — the macros, the package, the staging — and defers
  here for the why.
- **The suite asserts these against the rendered PDF**, not against the source:
  both labels appear, the catch-all prints after every other alternative on the
  copies that draw it, the code question prints the body of its `.java`, and the
  removed instruction is gone.

## References

- ADR-0031 — the reading report, and why the appended box is off.
- ADR-0032 — the published question bank, which must supply what a sheet needs.
- `docs/design/2026-08-controles.md` §C6 (the shuffle), §C7 (the grade).
- `apps/amc-worker/tests/fixtures/control-demo.tex` — the worked example.
- `apps/amc-worker/PAPER-CHECK.md` — the check that reads a real printed sheet.
