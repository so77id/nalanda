# ADR-0057: Inline math and code in `<Slide title>` (and other JSX attribute titles)

**Status:** Accepted
**Date:** 2026-08-27
**Decision-makers:** Miguel Rodriguez
**Covers:** the runtime renderer for JSX-attribute titles (`renderInlineTitle`) · the lazy KaTeX chunk that avoids inflating the entry bundle · the `slugSource` prop added to `MdxHeading` so slugs stay consistent between the source reader (`headingSlugs`) and the rendered reader (`useSections`)
**Source:** Issue #221 — Miguel review round 2, 2026-08-27. He wants slide titles to support inline math (`$$...$$`) and inline code (`` `...` ``) the same way body prose does, because the deck has real technical titles like `Factorial: $$T(N) = T(N-1) + c$$` and `Verificación con `` `<Benchmark>` `` that read as literal text otherwise.

## Context

`<Slide title="…">`, `<Figure caption="…">`, and similar components pass
their title through a JSX attribute — a plain JavaScript string that never
enters the MDX pipeline. `remark-math` and `rehype-katex` process body
prose at build time; the `pre`/`code` mapping renders backticks in body
prose too. Neither reaches a JSX attribute value.

The `add-a-course-document` guide used to state this as an authoring
restriction:

> **A `<Slide title="…">` cannot hold a formula**: the title is a JSX
> attribute, so the `$$` ship to the reader as literal characters,
> projected.

Two problems with that restriction, both surfaced during the Peli 2
review:

1. **The workaround (move the formula into the slide body) is
   pedagogically noisy.** Titles like `Factorial: $$T(N) = T(N-1) + c$$`
   are the section anchor and the presentation cover heading; asking
   authors to move the formula down loses the compact "concept + form" a
   good technical title carries.
2. **The workaround silently degrades the section spine.** A title of
   the form `## $$\log_2 n$$` produces an empty slug (`textOf` returns
   nothing for element children), so the section vanishes from the rail
   with a green build (documented in `reactText.ts`). The Slide path has
   the same hole.

The right fix is a small runtime processor that handles the two things
authors actually need (math and code) inside a title, without touching
the rest of the pipeline.

## Decision

**1. Adopt `renderInlineTitle(title: string): ReactNode`** as the shared
inline-title processor. Callers wrap their title expression:

```tsx
{title ? <H2 slugSource={title}>{renderInlineTitle(title)}</H2> : null}
```

**2. Tokenise on two delimiter classes only.** `$$…$$` (math, greedy) and
`` `…` `` (inline code, non-greedy on backticks). No bold, italics, links,
or headings — a title is a one-line concept, and expanding the parser
would replicate the whole markdown pipeline for two authoring needs.

**3. KaTeX is lazy-loaded.** The runtime `katex` package weighs ~260 kB
minified and would otherwise ship in the entry chunk of every page.
Slide is used on every document, so importing `katex` eagerly would put
it on the initial paint of a page with no math at all. The chunk is
split via `React.lazy(() => import('./katexInline'))` and wrapped in
`<Suspense>` with the raw LaTeX as fallback — a page with no title math
never fetches the chunk, and a page with title math shows the raw LaTeX
for a moment before it swaps in the rendered formula. `architecture.test.ts`
`pulls in no package beyond what the first paint needs` guards the
boundary.

**4. `MdxHeading` gains an optional `slugSource` prop.** When present it
overrides `textOf(children)` for slug computation. Slide passes the raw
title string, so the h2's id ends up as `slugify(rawTitle)` — the same
result `headingSlugs` produces from the mdx source. This is what keeps
the source reader and the rendered reader in agreement
(`questionReaders.test.tsx > source reader and rendered reader agree`).

Without `slugSource`, `textOf` sees only the rendered elements (spans,
code, KaTeX HTML) and yields empty text — no slug, no id, no rail entry.
The prop is opt-in: markdown `##` headings continue to work through
`textOf` unchanged (their children are strings, which is what `textOf`
walks).

**5. `useSections` handles KaTeX output already.** The rendered reader
strips `[aria-hidden="true"]` and `<annotation>` elements before reading
`textContent`, so a heading with rendered math produces the same
readable text a screen reader would hear. This was already there for
body-formula headings (`## $$\log_2 n$$`); it now covers Slide titles
too, for free.

**6. Malformed titles fail visibly, not silently.** An unbalanced `$$`
or a stray single backtick is kept as literal text in the token stream —
the same behaviour body math has ("a malformed formula renders in
KaTeX's error colour", per the guide). Authors see the malformation
rather than the parser silently swallowing part of the title.

## Alternatives considered

**Restrict authors to plain-text titles.** This is what the guide used
to say. Rejected on Miguel's review: the workarounds (move the formula
into the body; drop the code font on `<Benchmark>`) are pedagogically
worse than the fix, and one of the workarounds silently loses the
section rail entry.

**Recurse `textOf` into elements.** The nuclear fix — make `textOf` walk
into element children so a formula-only heading picks up its raw text.
Rejected explicitly by ADR-0027 §8: recursing changes published slugs
across the site (`la-trampa-de-seguido-de` becomes
`la-trampa-de-nextint-seguido-de-nextline`), and there is no migration
plan.

**Preprocess titles at build time through the MDX pipeline.** Real but
much bigger: it would require an MDX transform pass that identifies
JSX attribute values on known components and rewrites the AST. High
blast radius; low payoff for two authoring needs.

**A separate `<SlideTitle>` component the author writes explicitly.**
E.g. `<Slide><SlideTitle>Costo <InlineMath>...</InlineMath></SlideTitle>`.
Rejected: authors already write `<Slide title="…">` everywhere in
`content/`, and the `title` prop is what `headingSlugs`, section rail,
question anchoring, and the presentation cover all read. Introducing a
second title surface splits every consumer.

**Eager import of `katex`.** Rejected by
`architecture.test.ts`. The runtime `katex` chunk must not ship in the
entry chunk; the guard exists specifically to prevent this drift.

## Consequences

**Deprecates one section of the authoring guide.** The paragraph telling
authors to move formulas out of `<Slide title="…">` no longer applies.
Same paragraph now says: `$$…$$` and `` `…` `` work in titles.

**One new eager module** (`renderInlineTitle`) plus one lazy module
(`katexInline`). The eager module is tiny (a tokenizer + fragment
render); the lazy module carries the katex import.

**Backwards compatible.** Every existing title that is plain text
renders byte-identical to before. Only titles that already contained
`$$` or backticks change — those were rendering as literal characters
and will now render correctly. `useSections`, `headingSlugs`,
`documentSections.test.tsx`, and `presentationRoute.test.tsx` all
pass without modification.

**Loading UX**: when a title has math and the katex chunk hasn't
landed yet, the reader sees `$T(N) = T(N-1) + c$` (raw LaTeX in the
fallback span) for the fraction of a second before it swaps to the
rendered formula. No content jumps in position — the fallback occupies
comparable width.

**Screen readers**: KaTeX's `htmlAndMathml` output includes semantic
`<math>` markup alongside the visual HTML. The section-rail reader
already strips the visual half; the MathML half is what the AT reads.
Titles with formulas are now spoken as "T sub N equals T sub N minus
1 plus c" rather than "dollar dollar T of N equals…".

**Titles containing `$` that should NOT be math** (a title mentioning
money, say) need to be written as ordinary characters since the
tokenizer requires DOUBLE dollars. Single `$` is left alone, matching
ADR-0027's rule for body math.

**No package.json change.** `katex` is already a dependency (used at
build time by `rehype-katex`); this decision uses the same package at
runtime for the two title paths.
