# ADR-0027: Mathematics is rendered before it ships, and `$$` is what delimits it

**Status:** Accepted
**Date:** 2026-08-14
**Decision-makers:** Miguel Rodriguez
**Covers:** why KaTeX runs at build time and not in the reader's browser · why the
delimiter is `$$` and not the usual `$` · why the stylesheet is global · what a page with
mathematics costs and what a page without one costs · what happens to a malformed formula
**Source:** Issue #118 (WP: render LaTeX for mathematical notation in course content),
promoted from Discussion #86. Extends ADR-0012 (the content pipeline) with a second
plugin tree; the cost comparison is against ADR-0018 §Consequences (the editor layer).

## Context

The course is Estructuras de Datos y Algoritmos, so mathematics is the material rather
than decoration, and until now there was no way to write it. `03-busqueda-binaria.mdx`
stated the cost of binary search as `log₂(n) + 1`, typed in Unicode subscripts, because
that was the best the platform allowed. Everything ahead is worse: recurrences,
summations, induction proofs, and the grade formulas of the opening class (#120), which
is the most-read slide of the first session.

Discussion #86 framed the choice as a weight question and asked for the number before
the decision, in the same family as #85: how much does a document pay to look right.

## Decision

### 1. KaTeX runs during the build, not in the browser

`remark-math` parses the delimiters into math nodes; `rehype-katex` renders each node to
HTML **inside the Vite transform, in Node**. The consequence is the one that made this
cheap: **KaTeX is a build input and none of its JavaScript is ever sent to a reader.**
What ships is markup that was already rendered, a stylesheet, and font files.

The two lists live in `src/content/mdxPlugins.ts` and `src/content/rehypePlugins.ts`
rather than inline in `vite.config.ts`, for the reason the first was extracted: a test
compiles through the *same* list the build uses. Both are asserted twice — through the
exported lists and through the resolved config — because a guard that reads a config as
text can prove a name appears and cannot prove the value is used, which is exactly how
GFM fell out of the build while every test stayed green (#83).

### 2. A formula is delimited by `$$`, not by `$`

`singleDollarTextMath: false`. This departs from the LaTeX convention deliberately.

With single dollars enabled, an ordinary Spanish sentence about money becomes
mathematics. Measured, not feared:

    Cuesta $200 al mes, el otro $350.

renders "200 al mes, el otro" as a formula. That sentence is on the cloud-cost slide of
the opening class, and nothing warns about it — the build is green, the content gate sees
nothing wrong, and the page reads as garbage.

The trade is real but **asymmetric, and the asymmetry is the argument**. The default lets
a document whose author never opted into mathematics at all break silently. A loud
failure for someone who asked for the feature beats a quiet one for someone who did not.

**What a single-dollar formula actually does, corrected during review.** The first draft
of this ADR claimed the cost was mild — "the formula sits there as plain text" and the
author fixes it. Measured, that is only true of brace-free bodies like `$n$`. MDX reads
braces as expressions, so:

| Source | What the reader gets |
|---|---|
| `Sea $\frac{1}{2}$ del total.` | `Sea $\frac12$ del total.` — the braces are gone |
| `Hay $\log_{2}(n)$ pasos.` | `Hay $\log_2(n)$ pasos.` |
| `Sea $\sum_{i=1}^{n} i$ la suma.` | **the build fails**: `ReferenceError: i is not defined` |

Silent corruption of the source, or a build error naming a LaTeX subscript variable as if
it were JavaScript. Both are worse than the plain text the first draft described, which
makes the case for `$$` stronger rather than weaker. The `$$` form is immune because math
content is taken raw.

**The residual case.** `singleDollarTextMath: false` moves the prose collision rather
than removing it: `El servidor cuesta $$200 al mes, el otro $$350.` is still swallowed
whole, identically to the failure the option was chosen to prevent. Unrealistic in
Spanish prose, but the asymmetry above is stated with its limit rather than as absolute.

Inline and display differ by where the delimiters sit, the way a code fence does:
`$$x$$` on one line is inline, `$$` alone on its own lines opens a block. The
distinction is one line break and produces two very different results, which is why it
is pinned by a test rather than left to the guide.

### 3. The stylesheet is global — and that is debt, taken knowingly

`katex.min.css` is imported once, in `styles/index.css`, so every page carries it:
**+8.26 kB gzip on every page in the site, whether or not it contains mathematics.**

The fonts are not part of that. They are the expensive half — 20 faces — and a browser
fetches a face only for glyphs something actually renders. Verified in a browser: a
document with one formula requests exactly two woff2 files, and a document with no
mathematics requests **none**.

**The first draft of this ADR justified the global import by saying that scoping it per
document "would fight Vite's CSS splitting". That was false, and it was measured false
during review.** Importing the stylesheet from a document module splits cleanly and
returns the app stylesheet to its exact pre-math size:

    dist/assets/03-busqueda-binaria-*.css   30.20 kB │ gzip: 7.95 kB
    dist/assets/index-*.css                 49.37 kB │ gzip: 8.55 kB   ← the baseline

with a browser trace confirming the consequence: the math-free page loads one stylesheet
and no fonts, the math page loads two and the same two woff2. So "a page without
mathematics pays nothing" is **literally achievable**, not merely approachable.

It is global anyway, and the reason is speed of delivery rather than a build constraint:
this WP unblocks #120, and one unconditional stylesheet is the shortest path there. **The
debt is recorded here rather than hidden behind a technical claim, and the exit is
known**: inject the import from a remark plugin when a document contains a math node
(an alias is needed, because `content/` resolves outside `apps/web`). Worth paying down
when a second measurement says 8.26 kB matters, or when the catalog of math-free
documents grows enough that the ratio embarrasses.

Recording the false version of this reasoning is deliberate. This repo has already
shipped one regression behind unverified build-weight reasoning (#83, and the 5.8 kB gz
that #104 had to chase), and the failure mode is exactly a plausible sentence nobody
re-measures.

### 4. All three font formats are published

KaTeX declares each face in woff2, woff and ttf; the build emits all 59 files, **1047.8
kB** (19 woff2 / 250.2 kB, 20 woff / 296.0 kB, 20 ttf / 501.6 kB). A browser picks the
first format it understands, which for anything able to run this app is woff2, so
**797.6 kB is published and never requested**. **Accepted knowingly by the repo owner**:
the host is GitHub Pages, where that storage is free.

**One exception, and it is not hypothetical for an algorithms course**: `KaTeX_Size3-Regular`
ships no woff2 at all. A formula using size-3 delimiters — a `\left(` around a tall
fraction, a display-size `\sum` — fetches its 13.2 kB `.woff`.

What the dead formats cost every reader is **474 bytes gzip**, which is 5.8% of the CSS
delta. Measured by stripping every `woff`/`truetype` `url()` from the built stylesheet:
16,613 B gz → 16,139 B gz. The `@font-face` blocks as a whole are 65% of the delta, so
even a woff2-only build would carry 4,807 B of them.

An earlier draft of this section explained the delta by saying hashed asset paths do not
compress. Measured, de-hashing every font filename saves 445 B gz — about 5% of the
delta, so the explanation was directionally right and quantitatively backwards. The
delta is mostly the stylesheet itself.

### 5. A malformed formula renders wrong; it does not fail the build

`rehype-katex` keeps its default `throwOnError: false`. A broken formula appears in
KaTeX's error colour and the document still builds. Failing the build was considered and
rejected: the content gate refuses documents for *structural* faults — a missing id, a
bad index — while a typo inside a formula is authoring feedback. It matches how a broken
wiki-link behaves, visibly wrong on purpose (ADR-0002).

**One failure is not local, and an author must know it.** An **unclosed** `$$` does not
produce one red formula — it swallows the entire remainder of the document, headings
included, into a single error span. The section spine empties, and in an `auto` document
every slide below the typo disappears from the deck. The build stays green and
`contentIntegrity` sees nothing, because it gates frontmatter and the index, not body
syntax. The symptom to recognise is "the document ends here", not "one formula is red".

### 6. `trust` stays off, and is written down

`rehypeKatex` is passed `{ trust: false }`. That is already KaTeX's default, and it is
stated explicitly because it is the one option whose flip is a direct injection: with
`trust: true`, `\href`, `\url` and the `\html*` family emit real attributes out of
author-written LaTeX — verified during review, `\href{javascript:alert(1)}{x}` becomes a
live anchor. Enabling it, or adding `macros` that reach those commands, needs a security
review. Pinned by a test so the flip cannot be made quietly.

The default was attacked before being trusted: ten hostile documents compiled through the
real build path produced red error text for every trust-gated command, and never an
anchor, class, id or data attribute. There is defence in depth behind it — KaTeX-emitted
elements resolve through the MDX component map, where `a` is `MdxLink`, which already
refuses non-`http(s)`/`mailto`/local schemes.

### 7. Which KaTeX renders

`rehype-katex@7` declares `katex: ^0.16.0`, so it cannot use a 0.18. The direct
dependency is therefore pinned to **`^0.16.47`**, and npm dedupes to a single copy that
both renders the formulas and supplies their stylesheet.

This is written down because the first version of this WP got it wrong in a way nothing
caught: it pinned `katex@^0.18.4`, which supplied the CSS while 0.16.47 — nested under
`rehype-katex` — did the rendering. The class names differ between them (0.18 defines
`.katex-base`/`.katex-strut`; the markup emits `.base`/`.strut`), so formulas shipped
styled by a stylesheet that had no rules for them: measured in a browser, `.strut`
computed `display: inline` instead of `inline-block` and `.base` `position: static`
instead of `relative` — the two things KaTeX uses for vertical alignment. It looked
almost right, which is why only a class-by-class comparison found it. **When bumping
KaTeX, bump what `rehype-katex` resolves, not just this manifest line.**

## Consequences

**Measured** on a clean `npm ci` build, baseline `f68d497`, after at `03acee9`. Run from
a tree with no stray `dist*` directory: Tailwind scans one, and a previous build's class
names inflate the CSS reading by ~1.6 kB gz. That is how the first version of this table
overstated the document chunk.

| | Before | After |
|---|---|---|
| App CSS | 49.37 kB → 8.55 kB gz | 78.71 kB → **16.81 kB gz** |
| JavaScript shipped | — | **unchanged; zero** |
| `03-busqueda-binaria` chunk | 2.07 kB → 1.03 kB gz | 5.17 kB → **1.66 kB gz** |
| Font files in `dist/` | 0 | 59, 1047.8 kB |
| Fonts a formula requests | — | 2 woff2, 42,712 B |
| Fonts a math-free page requests | — | **0** |
| Build time | 3.17–3.95 s | 3.20–3.67 s (within noise) |

The zero-JavaScript claim is hard-verified, not inferred: the entry chunk is
byte-identical across the change, and `grep` for KaTeX's own runtime strings over
`dist/assets/*.js` returns nothing. The document chunk contains only the class names.

So: **+8.26 kB gz on every page**, and +0.63 kB gz of markup plus ~42 kB of fonts on the
pages with a formula.

**The comparison with ADR-0018, stated fairly.** #86 asked for it and the first draft
gave a single flattering ratio. Two numbers is the honest form, because the axis that
matters is conditionality — and ADR-0018 is precisely the decision that established it:

- A page **with** mathematics pays ~51 kB, against ~162 kB gz for a page with a code
  fence. Cheaper, and it runs no script at all.
- A page **without** mathematics pays 8.26 kB gz. A page without a fence pays **zero**.

The second line is the one that makes §3's debt visible instead of hiding it inside a
ratio.

**On a slide**, measured against the production build: scale 1.00 at 1024×768, and 0.895
on an iPhone 13 in landscape. Both are above the 0.8 floor and far above the ~0.5 point
where the authoring guide records body text ceasing to be readable. **Caveat**: measured
on a temporary slide, because no shipped document currently puts a formula in a deck —
`03-busqueda-binaria.mdx` keeps its cost section book-only. Reproducing these numbers
means adding one, and #120 is where a deck with mathematics first ships for real.

**Layout shift.** Mathematics adds none of its own: KaTeX bakes build-time metrics into
inline styles, so blocking the woff2 files versus loading them leaves every formula box
identical to the sub-pixel. But page CLS on the math document moved 0.270 → 0.298,
because the pre-existing unexplained shifts of #96 scale with document height and the
page got taller. All three shifts fire at ~375 ms, before any font could arrive — a
datapoint for #96, which is still open.

**DOM weight.** Two trivial formulas add 53 elements to a 251-element page, ~26 elements
and ~1.5 kB raw each. No measurable cost at this size; recorded so #120 has a baseline
before a slide carries a dozen.

**Build-time resource use.** KaTeX now runs in Node on author-controlled content.
Expansion bombs and deep recursion are bounded — `maxExpand` stops `\def` loops, and a
stack overflow is caught and degraded to an error span — but **output size is not**: an
80 kB `\begin{matrix}` produced 40 MB of compiled JSX in 29 s. Accepted while `content/`
is repo-reviewed; it is a second reason to re-review the pipeline at the moment
`docs/security-notes.md` already names, when a non-repo-authored content path appears.

**Known limit, not fixed here.** An `h2` that is *entirely* a formula gets no id, no
self-anchor and no entry in the section spine, which contradicts ADR-0021 and ADR-0002.
The fix is to make `textOf` recurse into elements — and that changes existing slugs:
`06-java-desde-cpp.mdx` has a heading whose published anchor is `la-trampa-de-seguido-de`
and would become `la-trampa-de-nextint-seguido-de-nextline`. Breaking a live deep link is
a decision with its own migration. Write a heading with text in it; the authoring guide
says so.

**Accessibility**: KaTeX emits MathML beside the visual spans, so a formula is readable
by assistive technology rather than being a picture of one. Asserted separately from the
visual rendering, because losing it is invisible on screen and total for anyone not
looking at one — the same class of defect `documentShell.test.ts` guards for accessible
names on a page served `lang="es"`.

**For authors**: the guide gains a math section. The `$$` rule is the part that will
surprise anyone who has written LaTeX before, and the price sentence is why.

**Left open**: the `semantic` catalog family is still empty. A `<Teorema>` or
`<Definición>` wrapping a formula is a plausible first habitant and remains a separate
decision (#86 §Notes), untouched here.
