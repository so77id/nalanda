# ADR-0039: The professor chooses the page layout per control, not the reader

**Status:** Accepted
**Date:** 2026-08-18
**Decision-makers:** Miguel Rodriguez
**Source:** #185 (opt-out padding), incident 2026-08-18 (the first real control
generated from the Jetson printed with a blank filler page between copies).

## Context

AMC's `\onecopy{N}{...}` block ends with `\AMCcleardoublepage`, which pads each
copy to an even page count so that duplex printing puts one physical sheet per
student. When the professor prints **simplex** — Miguel's habitual case — that
padding surfaces as a blank sheet of paper between every pair of prints, a
per-copy waste that the physical world eats.

Two shapes were considered:

- **The layout is a global fact of the engine** (status quo). Every generated
  control uses `\AMCcleardoublepage`; the professor either wastes paper or
  post-processes the PDF.
- **The layout is a preference of the control** (this ADR). A checkbox on the
  create form persists a bit on the row; the tex generator emits
  `\AMCcleardoublepage` or `\clearpage` based on it. Default padded, so nothing
  existing changes shape.

The second is what shipped. The bit lives on `control.duplex_padding`
(migration `00006_duplex_padding.sql`) so a future WP-G regeneration honours
the same preference — asking the professor again on regeneration would
surface an accident, not a choice.

The alternative to changing the .tex — post-processing the PDF to strip even
pages — was rejected: it assumes AMC's layout is exactly "odd = content, even
= padding" and would break silently the first time a question flowed to a
second page. Emitting the correct source is the whole point of a generator.

## Decision

- `control.duplex_padding` is `1` (padded) by default; the form checkbox is
  checked by default; the tex generator emits `\AMCcleardoublepage` when true
  and `\clearpage` when false.
- The preference is per control, not per course or per professor. Two
  controls from the same professor in the same semester can differ (a long
  duplex exam and a one-page simplex quiz).
- The default direction of the checkbox stays `checked` even though Miguel
  personally prints simplex most of the time: keeping historical shape
  reversible is more valuable than saving a second click today. If in the
  future every generated control turns out unpadded, a follow-up WP inverts
  the default — but a data-driven inversion, not a guess-driven one.

## Evidence the reader tolerates the unpadded shape

The concern raised while spec'ing #185 was: does the AMC scan reader still
work when each copy is one page rather than two? If AMC prints an identifier
on every page and the reader expects to see every page for every copy,
missing the padded blank could put copies into `needs_review` or fail the
batch.

**Already answered.** ADR-0030 §"Second cycle — 2026-08-17 (minimum paper
check, pencil)" documents the exact test: three copies of
`control-paper-min.tex` (which uses `\clearpage` instead of
`\AMCcleardoublepage` at the end of `\onecopy`), printed one-page-per-copy,
marked in pencil, scanned, read. Result: 3/3 pages captured, RUTs read on
two copies, third copy correctly refused because the professor left a column
blank on purpose. The reader handled the unpadded layout end-to-end.

The mechanism is orthogonal to what our server adds around it: AMC's
page-break machinery (`\clearpage` versus `\AMCcleardoublepage`) does not
interact with `\shufflegroup{clase}` or `\insertgroup[N]{clase}`. A server-
generated control with N random questions ending in `\clearpage` inherits
the same paper evidence as the min fixture. This ADR **does not** open a
new PAPER-CHECK — the min cycle covered the mechanism this WP toggles.

Follow-up cycle worth doing when the paper budget allows: one full-shape
server-generated control (say 5 questions × 3 copies) with the checkbox
unchecked, to confirm the inherited evidence with the exact shape the
server produces. Not blocking; documented here so it does not disappear
from the queue.

## Consequences

**Positive:**
- One paper sheet saved per copy for simplex-printing professors — the first
  real production control (2026-08-18) generated 5 copies × 2 pages = 10
  sheets, of which 5 were blank filler. With the checkbox unchecked the same
  control produces 5 sheets, no filler.
- The `.tex` source stays honest: the layout the professor wants is what the
  generator emits, no post-processing.

**Negative / trade-offs:**
- Two shapes of `.tex` to reason about in `tex.go` and its tests. The branch
  is one `if` and the tests pin both directions, so drift is caught by the
  suite (`TestDuplexPaddingBranchesOnAMCcleardoublepageVsClearpage`).
- A future engine swap (ADR-0030 §Reversibility: swap to OMRChecker) has to
  honour the preference too. The bit is stored at the domain level, not on
  the AMC side, so the swap is a matter of the new adapter reading it.
- Regeneration (WP-G, when it lands) has to read the preference from the row
  rather than re-asking. Column exists; the caller has to remember.

## Review triggers

- **The default direction is reconsidered** when we see a semester of
  controls and the split is heavily one-sided. A run that produces >90%
  unpadded is a signal that the default should flip.
- **The evidence needs a full-shape cycle** when a professor generates a
  multi-page control with the checkbox off and the reader misbehaves.
  Today the min-fixture evidence is inherited on the argument that page-
  break and question-insertion are orthogonal; a counter-example redirects
  us here.

## Alternatives considered

- **Global config flag** — one professor's preference wins for the whole
  server. Rejected: no reason to force it to be global, and per-control is
  what the physical world already asks for.
- **A `layout: duplex | simplex` enum** — three-value or more in the
  future. Rejected: two values, one bit, and any future layout mode gets
  its own field (e.g., `booklet: bool`) rather than a growing enum whose
  values interact.
- **`bool DuplexPadding` at Go zero value = false** — the SQL default is
  `1` but the Go zero is `false`. A caller that forgets the field would
  produce unpadded controls silently. Chose `bool` anyway because the
  only caller is the handler and the handler always parses the form,
  which always sets it. A struct-tag-driven "required" would add ceremony
  the shape does not need.

## References

- ADR-0030 — the AMC engine and its traps, §"Second cycle — 2026-08-17"
  for the reader evidence this ADR inherits.
- ADR-0033 — the sheet carries its own arithmetic (surrounding tex layout
  decisions).
- `apps/server/internal/domain/controls/tex/tex.go` — the branch.
- `apps/server/migrations/00006_duplex_padding.sql` — the column.
- `apps/server/internal/app/web/view/templates/pages/controls_form.html` —
  the checkbox.
