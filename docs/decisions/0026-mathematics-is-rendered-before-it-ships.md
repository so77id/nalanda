# ADR-0026: Mathematics is rendered before it ships, and `$$` is what delimits it

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

The trade is real but **asymmetric, and the asymmetry is the argument**. Requiring `$$`
means a formula copied from elsewhere with single dollars does not render — but its
author was writing mathematics, sees plain text where a formula should be, and fixes it
in seconds. The default lets a document whose author never opted into mathematics at all
break silently. A loud failure for someone who asked for the feature beats a quiet one
for someone who did not.

Inline and display differ by where the delimiters sit, the way a code fence does:
`$$x$$` on one line is inline, `$$` alone on its own lines opens a block. The
distinction is one line break and produces two very different results, which is why it
is pinned by a test rather than left to the guide.

### 3. The stylesheet is global; the fonts are not

`katex.min.css` is imported once, in `styles/index.css`, so every page carries it.

This looks like the thing ADR-0018 was careful to avoid, and is not, because the two
halves of the cost behave differently. The **expensive** half is the fonts — 20 faces —
and a browser fetches a face only for glyphs something actually renders. Verified in a
browser: a document with one formula requests exactly two woff2 files, and a document
with no mathematics requests **none**. Only the stylesheet is unconditional, and scoping
it per document would fight Vite's CSS splitting for a few kilobytes.

### 4. All three font formats are published

KaTeX declares each face in woff2, woff and ttf; the build emits all 59 files, 1.1 MB.
A browser picks the first format it understands, which for anything able to run this app
is woff2, so ~876 kB is published and never requested. **Accepted knowingly**: the host
is GitHub Pages, where that storage is free, and dropping formats is a compatibility
decision taken deliberately rather than inherited.

What it does cost every reader is CSS, because Vite rewrites each `@font-face` `url()` to
a hashed asset path and hashes do not compress — which is why the measured CSS delta is
larger than the stylesheet gzips to on its own.

### 5. A malformed formula renders wrong; it does not fail the build

`rehype-katex` keeps its default `throwOnError: false`. A broken formula appears in
KaTeX's error colour and the document still builds. Failing the build was considered and
rejected: the content gate refuses documents for *structural* faults — a missing id, a
bad index — while a typo inside a formula is authoring feedback. It matches how a broken
wiki-link behaves, visibly wrong on purpose (ADR-0002).

## Consequences

**Measured**, at `f68d497`, production build:

| | Before | After |
|---|---|---|
| App CSS | 49.37 kB → 8.55 kB gz | 79.57 kB → **16.82 kB gz** |
| JavaScript shipped | — | **unchanged; zero** |
| `03-busqueda-binaria` chunk | 2.07 kB → 1.03 kB gz | 6.11 kB → **1.83 kB gz** |
| Font files in `dist/` | 0 | 59, 1.1 MB |
| Fonts a formula requests | — | 2 woff2, ~42 kB |
| Fonts a math-free page requests | — | **0** |

So: **+8.27 kB gz on every page**, whether or not it has mathematics, and ~42 kB of fonts
plus ~0.8 kB gz of markup on the pages that do. Against the precedent #86 asked to be
compared with — the first highlighted fence on a page pulling ~162 kB gz of CodeMirror
(ADR-0018) — a page with mathematics is a quarter of that and runs no script.

**On a slide**, measured against the production build: scale 1.00 at 1024×768, and 0.895
on an iPhone 13 in landscape. Both are above the 0.8 floor and far above the ~0.5 point
where the authoring guide records body text ceasing to be readable.

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
