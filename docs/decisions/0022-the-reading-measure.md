# ADR-0022: The reading measure — narrow the text, not the column

**Status:** Accepted
**Date:** 2026-08-12
**Decision-makers:** Miguel Rodriguez
**Covers:** how wide running text is · why the reading column stays 768px · the opt-out
every document-facing component now inherits · what chrome may and may not take from the column
**Source:** Issue #84 (WP: the reading shell on a phone and inside a document), following a
UX/UI audit. Extends the component contract of ADR-0010 with an obligation; constrained by
the `<SideBySide>` measurement recorded in #76.

## Context

The UX/UI audit measured the reading column at **84 characters per line**
against a comfortable range of 60–75. That 84 is a count **excluding spaces**;
the same column measures ~102 counting them. The convention matters and is
recorded here because it was not recorded in the audit, and re-deriving it cost
a review round — see Consequences. The obvious fix is to narrow the
container, and it is the wrong one here.

This column is not a column of prose. It also holds code editors, exercises and
`<SideBySide>`, and `<SideBySide>` is tight **by measurement, not by taste**.
Issue #76 fixed line clipping on exactly this line:

```java
System.out.println("Bienvenidos a EDA");
```

It needs 376px. At a 768px container each `<SideBySide>` column is
`(768 − 12 gap) / 2 − 2 border` = **376px** — no margin at all. Narrowing the
container to 672px takes each column to ~330px and re-breaks the #76 fix.

A second force pulled the same way. The section rail needs
`256 (sidebar) + 64 (gutters) + 768 (column) + 224 (rail) = 1312px`, so it can
only appear at Tailwind's `2xl` (1536px). Narrowing the column would have
pulled the rail down to `xl` and shown it to many more people — a real
temptation, and the reason this decision needs recording rather than
re-deriving.

## Decision

**The container stays 768px. The running text narrows inside it.**

- Running text is capped at **39rem (624px)** and centred. Measured twice,
  independently, in Chromium at 1440px on `/d/java-desde-cpp` — counting the
  characters on each rendered line and dropping each paragraph's partial last
  one: **≈70 per line excluding spaces** (≈83 counting them), against **≈84
  excluding** (≈100 counting) for the full 768px column. The two runs agree
  within a character or two; the numbers are approximate by nature, since they
  depend on which paragraphs you sample. On the audit's own convention the
  column goes from 84 to 70.
- The rule lives in `styles/index.css` as
  `.measured-prose > :not(.not-prose):not(.measure-full):not(pre)`, applied to
  the document `<article>`. It is **unlayered on purpose**, so a child cannot
  escape it with a `max-w-*` utility — the opt-out is deliberate, not
  accidental.
- **Blocks keep the full column.** The exemption vocabulary is mostly one the
  product already had: `.not-prose` is what `CodeEditor`, `Exercise`,
  `SideBySide` and `AuthoringError` already marked themselves with, and `pre`
  covers a bare fence. `.measure-full` is new, for elements that are neither
  block nor running text — the scroll box around a table, the prev/next row,
  the `<SectionBreak/>` rule.
- **Chrome never takes width from the reading column.** Where a rail, panel or
  future affordance does not fit beside 768px, it moves into the drawer or
  disappears; the column is not squeezed to make room. This is what fixes the
  rail at `2xl` rather than `xl`.

**Consequence for component authors — this extends the ADR-0010 contract:** a
document-facing component that renders anything wider than running text MUST
mark itself `.not-prose` or `.measure-full`. Two existing components had to be
retrofitted in the same PR (`MdxTable`, `SectionBreak`), which is the evidence
that new ones will need it too.

## Alternatives considered

- **Narrow the container to ~672px.** Rejected: breaks the #76 `<SideBySide>`
  fix by 46px per column, measured. It would also have let the rail live at
  `xl`, which is precisely why it looked attractive.
- **Narrow the prose by giving every text element a Tailwind `max-w-*`.**
  Rejected: MDX authors do not write the wrapper elements, so there is no call
  site to put a utility on. The rule has to be structural.
- **A `<Prose>` wrapper component authors opt into.** Rejected: it makes every
  existing document wrong and asks an author to declare what they already
  declared by writing a paragraph.
- **Leave the measure at 84 characters.** Rejected by the audit; this is the
  text every student reads every day.
- **Narrow further, to ~31rem**, which is what 60–75 characters _counting
  spaces_ would need. Not chosen: issue #84 fixed the target at ~68 on the
  audit's convention, and 39rem meets it. Recorded so the next person to
  measure does not conclude the WP missed its own target — see Consequences.

## Consequences

**Good.** Reading quality improves everywhere without touching a single
document. Code, tables and interactive components keep the width they were
measured for. The exemption vocabulary is mostly pre-existing, so most
components already comply by accident of being blocks.

**Costs, stated plainly.**

- **A new obligation on every future document-facing component**, enforced by
  nothing but review: the failure is silent (a wide block quietly centred at
  624px), and the suite cannot see it because jsdom lays nothing out. The rule
  is therefore written into `frontend-code-style.md`, the component guide, and
  the catalog governance page — not only here.
- **The catalog does not show the truth.** `measured-prose` is applied only on
  the document page, so `/catalog` and presentation mode render components
  unmeasured. An author checking a new component in the catalog sees a width
  the document will not give it. Verify wide components in the book view of a
  real document (`npm run build && npm run preview`), not only in the catalog.
- **The rail is invisible between 1280 and 1536.** That is the price of the
  "chrome never takes from the column" rule, paid by laptop users. Below
  `2xl` the sections live in the drawer instead, so no width loses them.
- **39rem is a magic number** and stays one. It is written at the value with
  its measurement and with the case that breaks if it changes.
- **The target is met on one convention and missed on the other, and this is
  the honest statement of it.** Excluding spaces — the audit's convention —
  the column went 84 → 70, inside the 60–75 band. Counting spaces, which is how
  that band is usually quoted, it went 102 → 84 and is still above it. Nobody
  is wrong; the two numbers describe the same page. **Reviewed with both
  numbers in hand and left at 39rem** (Miguel, 2026-08-13). If a future reader
  wants 60–75 _with_ spaces, the value is ~31rem — a one-token change, and a
  fresh decision rather than an unfinished one.
