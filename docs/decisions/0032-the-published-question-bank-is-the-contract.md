# ADR-0032: The published question bank is the contract

**Status:** Accepted
**Date:** 2026-08-16
**Amended:** 2026-08-25 — page-only annotations (`<Explanation>`) are permitted authored content that deliberately does NOT enter the bank; see §Amendment.
**Decision-makers:** Miguel Rodriguez
**Covers:** the shape of `questions.json` as the `apps/web` → `apps/server`
contract · the join key from a printed sheet to a grade · why one authored
question is read by two readers, and what holds them in agreement
**Source:** Issue #139 (WP-B: the question bank), design `2026-08-controles.md`
C1/C2/C6/C14/C16. The downstream half of the same join is ADR-0031.

## Context

`apps/web` builds a control question bank out of `content/` and publishes it as
`questions.json`. A future `apps/server` reads that file over HTTP to generate a
printed entrance control, which is scanned and graded by `apps/amc-worker`.

The design narrative already closed the transport question (`2026-08-controles.md`
C14: publish an artifact rather than mount the repo beside the server, so the
server can never generate a control from a question the site does not show). What
it did not record is the artifact's SHAPE — and that shape is what the server
will be written against.

ADR-0031 exists for the mirror reason at the other end of the same join: *the
reading report is the contract*. It was split out of ADR-0030 on the reversal
test — a decision that survives the reversal of the ADR it is filed under is
filed under the wrong ADR. The bank passes that test in the other direction:
replace the Vite plugin, the MDX reader, or `apps/web` itself, and this shape is
still what `apps/server` binds to.

## Decision

**`questions.json`, at the site root, is the contract between `apps/web` and
`apps/server`.** It carries:

- `version`, so a shape change is a visible, breaking one.
- `documents`, **in `index.yaml` reading order**, each with its **section slugs
  in document order**. This is what resolves "from section X to section Y" into
  a pool without the server parsing a single `.mdx`.
- `questions`, each with: the authored `id`, its document, its `anchor` (or
  `null`), the derived `type`, the statement, the listing as **its own field**,
  the alternatives, and `correct` as an **index SET** into them.

Four properties are load-bearing:

**The `id` is the join key**, hand-written and stable. It travels into the
generated `.tex`, comes back from the worker as `answers[].name`, and lands in a
grade (ADR-0031). Deriving it fails both ways — anchor-plus-ordinal renumbers
when questions are reordered, a hash of the statement changes when a typo is
fixed.

**`correct` is a set of indices, and the shuffle happens downstream.** Every copy
shuffles its alternatives at print time (C6), so these indices index the AUTHORED
order and nothing else. A consumer that assumes printed order is wrong.

**The listing is a separate field** because the generator writes it to its own
file and the sheet reads it with `\lstinputlisting`, which needs no escaping at
all — braces, backslashes, `$`, `%`, `_` and `#` travel literally from the `.mdx`
to the printed page. Inline in the `.tex` every one of them would have to be
escaped, and a Java program is mostly braces. Measured: `verbatim` inside an AMC
question does not compile at all.

**Documents off the teaching path are skipped**, not appended. A control covers a
range of the reading order, so a document with no position in it has no range to
belong to and its questions would be unreachable by definition.

**The derived `type` originates here.** A question is `multiple` when more than
one alternative is marked, derived from the marks and never declared — a `type`
prop would be a second source of truth able to disagree with the checkboxes the
reader sees. ADR-0031 (as amended by #147) has the worker READ a type back from
AMC's scoring tables; that value is the echo, this one is the origin.

### Two readers, one gate

A question is read twice, on purpose: `content/questionSource.ts` reads the MDX
SOURCE for the gates and the artifact, `lib/questions.ts` reads the RENDERED tree
for the page. One reader cannot serve both — `import.meta.glob` with `?raw`
returns the COMPILED module here, because the MDX plugin claims the file first.

They are held in agreement by `app/questionReaders.test.tsx`, which renders every
published document and compares them. That gate is not decoration: four
divergences were shipping when it was written, and the worst was student-facing —
blank lines between alternatives make markdown emit a loose list, and every
alternative then read as incorrect, so a student marking the right answer was
told they were wrong.

**Consolidation trigger** (the shape ADR-0029 §3 uses): if MDX ever becomes
compilable at build time cheaply enough to emit the bank from the rendered tree,
one reader replaces two and this gate retires with them. Not before — and a
reviewer proposing the merge should read this section first.

## Alternatives considered

**Serve `content/` and parse MDX in Go.** Rejected by C14: it ties the deploy to
a checkout and lets the server and the site drift.

**One artifact per document.** Rejected: a control resolves a RANGE, so the
consumer would fetch and stitch an unknown number of files to answer one
question. The reading order is exactly what the single file exists to carry.

**`correct` as alternative ids or letters.** Rejected: letters are positional and
every copy shuffles, and ids on alternatives would be a second identifier to keep
stable for no gain.

**Deriving the question id.** Rejected — see above; both derivations fail the one
requirement the id exists for.

## Consequences

- **A schema change is a cross-app breaking change.** That is what `version` is
  for, and why the shape is here rather than in a docstring.
- **A duplicate question id fails the BUILD**, deliberately unlike the rest of
  the gate ladder. ADR-0029 §7 sets the rule — a content defect blocks
  publishing, not writing — and this is the exception: the id is the join key,
  and a duplicate silently merges two students' answers into one column. Do not
  harmonise it down to a suite gate.
- **The correct answers are published.** Consistent with C1 (the bank is study
  material and the page reveals answers anyway) and recorded as an accepted risk
  with its own review trigger in `docs/security-notes.md` — the two records
  govern one lever and neither may be reversed alone.
- The section spine the artifact carries is produced from the SOURCE, which
  ADR-0021 had rejected. See that ADR's amendment.

## Amendment — 2026-08-25 (page-only annotations)

`<Question>` may carry a nested `<Explanation>` block (a pedagogical note
attached to the answer). The block is authored the same way as the rest of
the question, but it is **deliberately dropped by the source reader** and
therefore never enters `questions.json` — the bank stays the exact
stems + alternatives + correct-set the contract promises. The rendered-tree
reader (`lib/questions.ts`) picks the note up separately and hands it to
`<Question>`, which paints it in a subtle panel below the verdict, only
after the reader has answered.

The asymmetry is by design: the printed sheet and the entrance-controls
generator must not see the explanation (a note that "spoils" the answer on
the printed page defeats the point of a control), while the study version
of the material benefits from teaching the WHY of the answer as the reader
crosses each question. "Two readers, one authored source, one artifact
deliberately unaware" is now a first-class pattern of the question
subsystem; any future annotator that follows the same shape (declared via a
`questionRole` value, dropped by the source parser, unwrapped by the
rendered-tree parser) inherits this ADR without needing its own.
