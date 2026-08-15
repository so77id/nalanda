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
compiles through the _same_ list the build uses. Both are asserted twice — through the
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

| Source                            | What the reader gets                                    |
| --------------------------------- | ------------------------------------------------------- |
| `Sea $\frac{1}{2}$ del total.`    | `Sea $\frac12$ del total.` — the braces are gone        |
| `Hay $\log_{2}(n)$ pasos.`        | `Hay $\log_2(n)$ pasos.`                                |
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
**+3.94 kB gzip on every page in the site, whether or not it contains mathematics.**

The fonts are demand-loaded and are not part of that — a browser fetches a face only for
glyphs something actually renders. Verified in a browser: a document with one formula
requests exactly two woff2 files, and a document with no mathematics requests **none**.

**That sentence was false when this ADR was first written, and the way it was false is
the more useful record.** `KaTeX_Size3-Regular.woff2` is 3,624 bytes, under Vite's default
`assetsInlineLimit` of 4096 — so Vite inlined it as a base64 data URI _inside the global
stylesheet_. One font for large delimiters was therefore downloaded by every page in the
site, math or not, at **4,343 bytes gzip: 52% of the entire cost of shipping
mathematics.** The build emitted 19 woff2 files where KaTeX has 20, and nobody noticed
the missing one.

`build.assetsInlineLimit: 0` in `vite.config.ts` fixes it, and the measurement is the
whole argument:

|                        | Inlined (as merged)    | `assetsInlineLimit: 0`     |
| ---------------------- | ---------------------- | -------------------------- |
| App CSS                | 77.29 kB → 16.70 kB gz | 72.48 kB → **12.36 kB gz** |
| Cost to every page     | 8.28 kB gz             | **3.94 kB gz**             |
| woff2 emitted as files | 19                     | **20**                     |

**The remaining 3.94 kB is still debt**, and the exit for it is different and larger:
scoping the stylesheet per document. That was also measured, after a first draft of this
ADR claimed — falsely — that it "would fight Vite's CSS splitting". It does not. Importing
the stylesheet from a document module splits cleanly and returns the app stylesheet to
its exact pre-math size:

    dist/assets/03-busqueda-binaria-*.css   29.30 kB │ gzip: 7.93 kB
    dist/assets/index-*.css                 47.98 kB │ gzip: 8.42 kB   ← the baseline

with a browser trace confirming the consequence: the math-free page loads one stylesheet
and no fonts, the math page loads two and the same two woff2. So "a page without
mathematics pays nothing" is **literally achievable**, not merely approachable. It is
global anyway, for speed of delivery: this WP unblocks #120, and one unconditional
stylesheet is the shortest path there. Tracked rather than narrated — see the issue
linked from this ADR's header.

Recording both false versions is deliberate. This repo has already shipped one regression
behind unverified build-weight reasoning (#83, and the 5.8 kB gz that #104 had to chase),
and the failure mode is exactly this: a plausible sentence nobody re-measures. Here it
happened twice in one WP, and the second one hid more than half the cost.

### 4. All three font formats are published

KaTeX declares each face in woff2, woff and ttf; the build emits all 60 files, **1072.9
kB** (20 woff2 / 256.2 kB, 20 woff / 303.1 kB, 20 ttf / 513.7 kB — decimal kB, matching
Vite's own output). A browser picks the first format it understands, which for anything
able to run this app is woff2, so **816.8 kB is published and never requested**.
**Accepted knowingly by the repo owner**: the host is GitHub Pages, where that storage is
free, and dropping formats is a compatibility decision rather than an inherited one.

What the dead formats cost every _reader_ is **511 bytes gzip** — 6.2% of the CSS delta
as merged, measured by stripping every `woff`/`truetype` `url()` from the built
stylesheet: 16,678 B gz → 16,167 B gz. The `@font-face` blocks as a whole are 64% of that
delta, so even a woff2-only build would carry 4,822 B of them.

An earlier draft explained the delta by saying hashed asset paths do not compress.
Measured, de-hashing every font filename saves 445 B gz — about 5%, so the explanation
was directionally right and quantitatively backwards. And an earlier draft claimed
`KaTeX_Size3-Regular` "ships no woff2 at all", which was wrong in both direction and
magnitude: the woff2 exists and was being _inlined into the stylesheet_ rather than
omitted. §3 carries what that cost and how it was fixed.

### 5. A malformed formula renders wrong; it does not fail the build

`rehype-katex` keeps its default `throwOnError: false`. A broken formula appears in
KaTeX's error colour and the document still builds. Failing the build was considered and
rejected: the content gate refuses documents for _structural_ faults — a missing id, a
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
author-written LaTeX. Verified during review: with `trust: true`, `\href{javascript:…}{x}`
emits a real `<a href>` **and** an `href` on the MathML `<mrow>`. React neutralises a
`javascript:` URL specifically — so that exact payload is defanged — but the attribute
channel is open and any other scheme rides it, which is why the flip needs a security
review rather than why it is survivable. Pinned by a test so it cannot be made quietly.

The default was attacked before being trusted: ten hostile documents compiled through the
real build path produced red error text for every trust-gated command, and never an
anchor, class, id or data attribute. There is defence in depth behind it — KaTeX-emitted
elements resolve through the MDX component map, where `a` is `MdxLink`, which already
refuses non-`http(s)`/`mailto`/local schemes.

### 7. Which KaTeX renders

`rehype-katex@7` declares `katex: ^0.16.0`, so it cannot use a 0.18. The direct dependency
is pinned to **`^0.16.47`** and npm dedupes to a single copy that both renders the
formulas and supplies their stylesheet. The postmortem of getting this wrong — and the
symptom that made it nearly invisible — is a dated note in `apps/web/README.md`, where a
dependency bump actually happens.

### 8. A published anchor is frozen

Heading slugs come from `lib/reactText.ts`, which contributes nothing for an element. A
heading that is _entirely_ a formula therefore has no text, gets no slug, and ships with
**no id, no self-anchor and no entry in the section spine** — silently. That contradicts
ADR-0021 (every `h2` the page paints becomes a section) and ADR-0002 (every `h2`–`h4` is
deep-linkable), and it is reachable from ordinary authoring only since this WP.

The fix is three lines: make `textOf` recurse into elements. **It is not taken, and the
reason is the decision.** Recursing changes slugs that already exist:
`06-java-desde-cpp.mdx` has a heading published at `la-trampa-de-seguido-de` which would
become `la-trampa-de-nextint-seguido-de-nextline`. The site is live and its documents are
handed to students as links.

So: **a slug that has been published is frozen.** Changing `slugify` or `textOf` is a
migration — it needs anchor aliases or redirects, and it needs to be decided as such
rather than arriving as a side effect of a heading fix. Until then, an author writes a
heading with text in it, and the guide says so. The same root cause gives a sibling limit:
a `<Slide title>` is a JSX attribute, so a formula there ships literal `$$`; that one is
authoring-visible and lives in the guide and the catalog entry.

## Alternatives considered

- **Single-dollar delimiters** (`$…$`), the LaTeX convention — rejected. Prose about
  prices parses as mathematics, and a pasted formula with braces is silently corrupted or
  fails the build. §2 carries the measurements.
- **`\(…\)` / `\[…\]`**, LaTeX's other pair — not adopted: `remark-math` does not offer
  them, and adopting them would mean a second syntax for the same thing.
- **Per-document stylesheet scoping** — measured, works, and **deferred rather than
  rejected**. It is the exit condition for §3's remaining debt, not a road not taken.
- **`throwOnError: true`**, failing the build on a bad formula — rejected. The content
  gate refuses documents for structural faults; a typo inside a formula is authoring
  feedback, and a broken wiki-link already renders visibly wrong on purpose (§5).
- **MathJax** (`rehype-mathjax`) — not adopted. Its package is 3× the size and its usual
  deployment renders client-side, which is the property that makes KaTeX-at-build-time
  cheap here. Not benchmarked; if mathematics ever needs what MathJax has and KaTeX
  lacks, that is the measurement to run.
- **KaTeX in the browser** — rejected on the cost that motivated the whole WP: it would
  ship ~90 kB gzip of JavaScript to do at runtime what the build already did once.
- **Authoring MathML directly** — rejected. It is unwritable by hand for a professor
  drafting a class, which is the actual user.

## Consequences

**Measured** on a clean `npm ci` build, baseline `f68d497`, after at `03acee9`. Run from
a tree with no stray `dist*` directory: Tailwind scans one, and a previous build's class
names inflate the CSS reading by ~1.6 kB gz. That is how the first version of this table
overstated the document chunk.

|                                 | Before                | After                      |
| ------------------------------- | --------------------- | -------------------------- |
| App CSS                         | 47.98 kB → 8.42 kB gz | 72.48 kB → **12.36 kB gz** |
| JavaScript shipped              | —                     | **unchanged; zero**        |
| `03-busqueda-binaria` chunk     | 2.07 kB → 1.03 kB gz  | 5.17 kB → **1.66 kB gz**   |
| Font files in `dist/`           | 0                     | 60, 1072.9 kB              |
| Fonts a formula requests        | —                     | 2 woff2, 42,712 B          |
| Fonts a math-free page requests | —                     | **0**                      |
| Build time                      | 3.17–3.95 s           | 3.20–3.67 s (within noise) |

The CSS row is measured against the baseline _after_ #109's two-theme system landed, by
building this branch with and without the `@import` — the honest form, since a rebase
moved the ground under the first reading, and since one number in an earlier version of
this table was taken from a tree with a stray `dist*` directory that Tailwind scanned.

The zero-JavaScript claim is hard-verified, not inferred: the entry chunk is
byte-identical across the change, and `grep` for KaTeX's own runtime strings over
`dist/assets/*.js` returns nothing. The document chunk contains only the class names.

So: **+3.94 kB gz on every page**, and +0.63 kB gz of markup plus ~42 kB of fonts on the
pages with a formula. As first merged it was 8.28 kB, of which 4.34 was a font Vite had
inlined into the stylesheet — §3.

**The comparison with ADR-0018, stated fairly.** #86 asked for it and the first draft
gave a single flattering ratio. Two numbers is the honest form, because the axis that
matters is conditionality — and ADR-0018 is precisely the decision that established it:

- A page **with** mathematics pays ~51 kB, against ~162 kB gz for a page with a code
  fence. Cheaper, and it runs no script at all.
- A page **without** mathematics pays 3.94 kB gz. A page without a fence pays **zero**.

The second line is the one that makes §3's debt visible instead of hiding it inside a
ratio.

**On a slide**: a formula renders and scales like anything else, and the binary-search
cost formula specifically does not shrink the slide at all — scale 1.00 at both 1024×768
and iPhone 13 landscape, re-measured during review. Two caveats, because the first
version of this paragraph carried neither. It cited "the 0.8 floor", **a threshold that
does not exist anywhere in this repo** — the only recorded one is the guide's "below
roughly half scale the body text stops being readable". And no shipped document puts a
formula in a deck, so there is no reproducible example: `03-busqueda-binaria.mdx` keeps
its cost section book-only, and #120 is where a deck with mathematics first ships. The
hazard worth checking is a _long_ display equation, which this one is not.

**Layout shift.** Mathematics adds none of its own: KaTeX bakes build-time metrics into
inline styles, so blocking the woff2 files versus loading them leaves every formula box
identical to the sub-pixel. But page CLS on the math document moved 0.270 → 0.298,
because the pre-existing unexplained shifts of #96 scale with document height and the
page got taller. All three shifts fire at ~375 ms, before any font could arrive — a
datapoint for #96, which is still open.

**DOM weight.** Two trivial formulas are 55 elements and 1,905 B of markup on a
235-element page at 1440×900 — ~28 elements and ~950 B each. No measurable cost at this
size; recorded so #120 has a baseline before a slide carries a dozen. The element count
of the page itself varies with viewport width, so the per-formula figures are the ones
that travel.

**Build-time resource use.** KaTeX now runs in Node on author-controlled content.
Expansion bombs and deep recursion are bounded — `maxExpand` stops `\def` loops, and a
stack overflow is caught and degraded to an error span — but **output size is not**: an
80 kB `\begin{matrix}` produced 40 MB of compiled JSX in 29 s. Accepted while `content/`
is repo-reviewed; it is a second reason to re-review the pipeline at the moment
`docs/security-notes.md` already names, when a non-repo-authored content path appears.

**Known limit, not fixed here.** An `h2` that is _entirely_ a formula gets no id, no
self-anchor and no entry in the section spine, which contradicts ADR-0021 and ADR-0002.
The fix is to make `textOf` recurse into elements — and that changes existing slugs:
`06-java-desde-cpp.mdx` has a heading whose published anchor is `la-trampa-de-seguido-de`
and would become `la-trampa-de-nextint-seguido-de-nextline`. Breaking a live deep link is
a decision with its own migration. Write a heading with text in it; the authoring guide
says so.

**Both themes, for free.** #109 landed its two-theme colour system while this WP was in
review, which made "is a formula legible in the light theme?" a question that did not
exist when the work started. It needs no rule of its own: KaTeX draws its glyphs in
`currentColor`, so a formula inherits `--tw-prose-body` exactly like the prose around it.
Measured in a browser on both:

| Theme | Formula              | Prose     | Contrast   |
| ----- | -------------------- | --------- | ---------- |
| Dark  | `rgb(168, 179, 192)` | identical | **8.90:1** |
| Light | `rgb(71, 82, 95)`    | identical | **7.02:1** |

Both are comfortably past WCAG AA, and the colours are identical to the body text by
construction rather than by coincidence — so a formula cannot drift from its paragraph
when the palette changes. The one KaTeX colour that is _not_ inherited is the `#cc0000`
of an error span, which is deliberate: it should look wrong in either theme.

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
