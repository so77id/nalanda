# ADR-0025: `content/` is also the test suite's fixture set

**Status:** Accepted
**Date:** 2026-08-14
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #108. Extends ADR-0013 §4 and qualifies ADR-0002 (content as a
separate domain) and `repository-structure.md` §Fixed taxonomy.

## Context

v0.1 has exactly one course directory and no synthetic content. Every test that
needs a real document — a real deck, a real section rail, a real `h2` — reaches
into `content/courses/sample-course/` through the live registry, because there is
nothing else to reach into.

That was already true and already accepted in a narrow form: ADR-0013 §4 leans on
a real document as the explicit-marker fixture guarding the compiled-MDX adapter.
There the arrangement costs nothing, because the fixture role and the content's
own intent agree — `busqueda-binaria` genuinely wants marked slides, and would be
written the same way if no test existed.

Issue #108 made every document declare its `presentation` mode and broke that
agreement. Walking the decks showed `01-bienvenida.mdx` for what it is: a landing
page about the platform, whose two sections are "Cómo navegar" and "Qué
encontrarás". Projected on a wall it is site navigation. Its content argues for
`presentation: none`.

It cannot have it. After #108 it is the only `auto` document in the tree, and the
markdown-`h2` path of the section rail — the primary path of ADR-0021's
decision — has no other real content to run over. Declaring `none` on it leaves
that path untested.

Two further couplings surfaced in the same review, both invisible from the
documents themselves:

- `documentSections.test.tsx` and `presentationRoute.test.tsx` were selecting
  their fixtures **positionally** ("the first `explicit` document"). Declaring
  `explicit` on a document earlier in the index silently moved one of them onto a
  document with no markdown `##` at all, so the case asserting that both heading
  sources produce one section list stopped exercising the mixed document it was
  written for. The suite stayed green at 576 tests while the case stopped testing
  what it is named for.
- `presentationRoute.test.tsx` drives `java-desde-cpp` at a **fixed slide index**
  (`?slide=5`). Nothing names it a fixture; it is a bare URL in a test.

## Decision

**In v0.1, `content/` serves two masters — published course material and the test
suite's fixture set — and where they conflict, the suite wins and the conflict is
recorded at the document.**

Concretely:

1. `01-bienvenida.mdx` declares `presentation: auto` although its content argues
   for `none`, to remain the suite's only `auto` fixture.
2. **Fixtures are named, never discovered.** A test that knows a document's
   content names that document, with a non-vacuity guard whose message says what
   to repoint and why. Positional selection is banned — recorded as a convention
   in `testing-strategy.md`.
3. **Editing `content/` requires the full suite, not the build.** A declaration
   change can redden a test that never mentions the document. Recorded in
   `guides/add-a-course-document.md` step 2 and in its checklist.

## Alternatives considered

- **Declare `none` on `bienvenida` and accept the coverage loss.** Rejected: the
  markdown-`h2` rail is the _default_ authoring path — the one every `auto`
  document uses — and it would have no coverage over real content while the
  `<Slide title>` path kept it. The cheaper-looking option removes the test for
  the more common case.
- **Declare `none` and add a synthetic MDX fixture under `src/` now.** Rejected
  for scope, not for correctness: this is the right end state and it is the exit
  condition below, but it is a WP, and #108 is a chore about frontmatter.
- **Take the exit immediately** (fixture course + registry injection). Rejected
  on cost. `buildRegistry(metaModules, loaders)` is already parameterised, so the
  registry half is nearly free; what blocks it is that the shell reaches the live
  singleton at module scope (`DocumentPage.tsx`, `Toc.tsx`, `MdxLink.tsx`,
  `content/index.ts`), and the tests that need fixtures render `AppRoutes`. This
  rejection is the decision actually being made here.
- **Leave it undocumented**, as it had been until now. Rejected: the constraint
  is invisible from `content/`, and an author following
  `repository-structure.md`'s claim that content "is edited without entering any
  `src/`" would hit a red suite with no way to know why.

## Consequences

- An authoring decision in this repository may be overridden by a test. That is
  a real cost paid by the reader of `01-bienvenida.mdx`, whose deck exists for
  the suite.
- `repository-structure.md`'s "edited without entering any `src/`" is qualified:
  still true for _writing_, no longer true for _verifying_.
- The invariant added by #108 reads frontmatter from source rather than through
  any of the app's seams, because each of them applies the default. Worth
  keeping visible: an `import.meta.glob` with `query: '?raw'` does not return the
  source either — the MDX plugin claims the file first and returns the compiled
  `MDXContent` function, so a frontmatter regex over it fails every case in a way
  indistinguishable from the invariant working.
- **Exit condition**: a dedicated fixture course plus registry injection through
  the shell. When a second course exists (multi-course is already a planned WP)
  much of this dissolves on its own, because a fixture course stops being a
  special case.
