# ADR-0024: A code fence in a language we run is a component, not markup

**Status:** Accepted
**Date:** 2026-08-13
**Decision-makers:** Miguel Rodriguez
**Covers:** which fences become components and which stay markup · why the highlighting
stayed at runtime for a listing that never runs · why the mapping is on `pre` and not on
`code` · what a fenced page now costs · where the eager/lazy line falls
**Source:** Issue #85 (WP: highlight every code fence with the read-only code component),
PRs #95/#101/#104. Extends ADR-0018 §4/§7 (runtime feature and editor layer) and
ADR-0019 §1–2 (code arrives as children); amends the Consequences of ADR-0003
(the catalog decides what documents may use).

## Context

Two kinds of code sat on the same page and looked like two products. Code shown
for reading was whatever the markdown renderer produced — grey monospace, no
colour. Code shown for running went through `CodeEditor`, which is CodeMirror
with a palette. In `06-java-desde-cpp.mdx` the two are stacked: a `<SideBySide>`
of two listings sits directly above a `<CodeEditor>` holding the same Java.

The `snippet` variant had been designed for exactly this case in #74 and wired
to nothing — `grep -rn 'variant="snippet"'` returned zero.

Making the listings match meant deciding something the repo had not decided:
whether a fence an author types in markdown is **content the renderer styles**,
or **a component the platform mounts**. ADR-0003's Consequences say the
components available inside a document are exactly those the catalog registers,
which by construction are the capitalised ones an author writes by name. A fence
is neither.

## Decision

**1. A fence tagged with a language the platform runs is a component.**
` ```java `, ` ```cpp ` and ` ```python ` render through the read-only `snippet`
variant of `CodeEditor`. Every other fence — untagged, or tagged with a language
we have no runtime for — stays exactly what it was, plain `<pre>`, and loads
nothing. The two ASCII diagrams in the shipped document are the reason that half
matters as much as the first.

The set is `RUNTIME_IDS`, matched **exactly**. An alias is a different language:
` ```C++ `, ` ```py `, ` ```Java ` all fall through to grey, silently, because
nothing on the page can tell an alias from a language we genuinely do not run.

**2. The renderer is the editor, at runtime — not a build-time highlighter.**
The alternative saves the whole cost (see Consequences) and was rejected on one
ground: a build-time highlighter uses its own token system, so on a slide that
carries two listings and one runnable editor, the listings and the editor come
out in different palettes. One renderer wins the coherence argument, and for a
teaching platform the coherence is the product.

**3. The mapping is on `pre`, never on `code`.** This is a constraint, not a
detail. `<Exercise>` finds its `starter` and its `test` fences by walking for
intrinsic `code` elements carrying `data-meta` (ADR-0019 §1–2). Mapping `code`
to a component replaces those intrinsics with a component type, the walk finds
nothing, and every exercise in the course renders its authoring-error banner
instead. Anything that later reads fences as data inherits this constraint: the
`code` element stays intrinsic.

**4. The registration lives in the shell's MDX map, not in `content/`.** The
mapping needs `components/`, and `content → components` is not an allowed edge
(`frontend-code-style.md`). It needs no catalog entry: the map ↔ catalog
completeness invariant covers capitalised keys only, and `a`, `table`, `h2`,
`h3`, `h4` are the standing precedent for an intrinsic override.

**5. Nothing under `runtime/` may be reached before first paint.** `MdxPre` is
in the shell's eager graph, so anything it imports is too. It needs to know
which language ids exist, and asking the runtime feature for them dragged the
registry, the descriptors and the Java launcher into the entry chunk. The ids
therefore live in `lib/runtimeIds.ts`, which imports nothing; `runtime/contract.ts`
re-exports them. This supersedes ADR-0018 §4's "a descriptor may travel in the
entry chunk".

## Alternatives considered

- **Build-time highlighting (Shiki, or Prism at build).** Zero client JS, and it
  is the only alternative that removes the cost entirely. ADR-0018 does reject
  "Prism/Shiki + `<textarea>`", but on the grounds of *"highlighting only, no
  editing"* — a reason about an editing component, silent on build time. That
  rejection does not cover a pure listing, and the honest record is that
  build-time rendering was never weighed for one before #85. It loses here on
  palette coherence (Decision 2), not on cost. **This is the thread to pull if
  the price is ever judged too high**, and the price is now written down.
- **Highlight only fences an author opts into**, with a marker in the info
  string. Rejected: it makes the common case the exceptional one, and every
  document already written would have to be revisited. The language tag is the
  opt-in an author already types.
- **A CSS-only treatment of the existing `<pre>`.** Cannot produce token colour
  without a tokenizer, and the tokenizer is the cost.
- **Mapping `code` instead of `pre`**, which reads more naturally. Rejected by
  the mechanics in Decision 3, and pinned by three tests.

## Consequences

- **A fenced page roughly doubles its JavaScript.** Measured on
  `03-busqueda-binaria.mdx` (prose plus one 10-line Java listing) from a network
  trace: **160.7 → 323.2 kB gz, +162.4 kB (+101%)** — 95.6 CodeMirror core,
  36.4 the wrapper, 17.7 the java grammar, 8.6 `@lezer/lr`, 2.9 the editor
  chunk. It is lazy, never in the entry chunk, and the first fence pays for all
  of them: further fences on the same page are free. No runtime is fetched — a
  listing runs nothing — so this is not the CDN cost the Run button pays
  (ADR-0018 §5). A page with no fence pays nothing.
- **A second language on one page adds its grammar**, and the grammars are not
  small: C++ 33.4, python 18.6, java 17.7 kB gz. A document that shows the same
  program in three languages pays for three of them. The five terms above and
  these three all reproduce from `npm run build` in `apps/web`, gzip level 6,
  kB counted as 1000 bytes.
- **A listing is not a place anyone typed, so it never restores a draft.** The
  draft store is keyed on the page path and lives on `so77id.github.io`, an
  origin shared with every other repo of the account; an unguarded read let
  planted bytes replace an authored listing *and* the payload of its copy
  button. The rule is `listing = !editable && !runnable`, written once and used
  by both the height and the draft guard. Residual and review triggers:
  `docs/security-notes.md`.
- **A container that frames its children must say so.** A fence inside a
  `<SideBySide>` column used to be styled by a `[&_pre]` descendant selector;
  a selector cannot reach inside a component, so the column and the editor drew
  two borders and two labels. The container now states the situation through
  `EmbeddedProvider` and the editor decides what to do about it — including its
  loading placeholder, which has to answer the same question or the doubled
  frame is visible for the length of the chunk fetch.
- **Authoring rules moved to the authoring guide, not here.** Which fences
  highlight, the alias trap, the height behaviour and the measured `Ctrl+F`
  result live in `guides/add-a-course-document.md` §3, which is where an author
  looks. This ADR does not restate them.
- **ADR-0003's Consequences are amended.** "The components available inside
  documents are exactly those registered by the catalog" is now true of
  *named* components only. An intrinsic element may also be a component; it is
  registered by the shell, has no catalog entry, and is invisible to the
  completeness invariant by design.
