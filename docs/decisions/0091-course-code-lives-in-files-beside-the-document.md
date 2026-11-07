# ADR-0091: Course code lives in files beside the document, and listings quote it

**Status:** Accepted
**Date:** 2026-11-07
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #363 (Grafos · TDA y modelado). Numbered 0091 to clear
`0090-*`, held by the unmerged branch of the pen-trace widget.

## Context

A class that teaches a data structure quotes the same code many times. In
#363 the matrix class `AdjMatrixGraph` appeared in a static listing, in two
step walks (`addEdge`, `hasEdge`, `adj`) and in the exercises, each a copy
pasted into a template literal. Three problems followed, all met during the
professor's review:

1. **Copies drift.** Compacting `if (!matrix[v][w]) E++;` on one slide left
   the other copies with braces; a walk's lit lines had to be renumbered by
   hand every time its copy changed.
2. **A fragment reads as the whole.** A walk over `addEdge` showed five lines
   numbered 1–5, with nothing saying they sit at lines 15–19 of a class that
   also holds `hasEdge` and `adj`.
3. **No file to point at.** The reader could not see `Main.java`, `Graphs.java`
   or `AdjMatrixGraph.java` whole, nor which file a fragment came from.

The professor asked for one copy per file, quoted by reference, with the
real line numbers, a visible sign of the code left out above and below, and a
way to open the whole file.

## Decision

1. **The code of a document lives in files beside it**, in a folder named
   after the document (`26-grafos-tda-modelado.code/`), a subfolder per
   exercise when two would share a name (`amigos/Solution.java`). The files are
   course material like its figures: under `content/`, published with it.
2. **A listing names a file and a range** instead of carrying the text:
   `<SourceFile src="./….code/Graph.java" range="12-16" />` for a static
   listing, `codeSrc` / `programSrc` / `helperSrc` with `…Range` on
   `<StepShow>`. The path is relative to the document and goes through the same
   rewrite as a figure's `src` (`remarkContentImages`, which since #363
   rewrites `src` and any `<thing>Src` attribute); `lib/contentCode.ts`
   resolves it against an eager `?raw` glob of `content/**/*.java`, imported
   only by the two widgets, which ship behind lazy wrappers.
3. **A quoted listing shows where it is.** Its header names the file and the
   range (`líneas 15–19 de 33`), its gutter counts as the file does, a fold row
   counts the lines left out above and below, and «Ver archivo» opens every
   file of the listing whole, one tab each, the quoted lines banded and — in a
   walk — the step's lines lit. A `<Step>`'s `lines` name FILE lines.
4. **The quoted text drops the indentation its lines share**, so a fragment of
   a method does not spend eight columns of a slide; the numbers stay the
   file's, and the viewer shows the file with its real indentation.
5. **A listing written in the document stays legal.** Code that exists only on
   its slide keeps a fence or an inline `code`; a fence may still name a file
   for its header (```` ```java file=Graph.java ````), without a range.

## Consequences

- One edit to a file changes every slide that quotes it. A walk's lit lines
  are the file's, so adding lines above a quoted range means moving the range
  and its steps: the range is the one thing an author keeps in step.
- The exercises' runnable `<Exercise>` starters still carry their own copy: an
  exercise compiles one source, and the harness does not read these files.
  Running the quoted files is a separate idea (a Discussion), not this ADR.
- A missing file is an authoring error on the page, the way an unresolved
  figure renders broken: the build does not fail on it.
- In `npm run dev`, a `.java` file added after the server started can stay out
  of the glob; touching `lib/contentCode.ts` or restarting the server picks it up.

## Alternatives considered

- **ESM `import x from './x.java?raw'` in the document.** Works with the MDX
  pipeline, but no document imports anything today, and the path would bypass
  the one rewrite every other file reference goes through.
- **Line markers in the source (`// region addEdge`).** Ranges by name survive
  edits better, but put teaching markup into the code the reader opens whole.
- **Keep the copies and lint them against each other.** Catches drift after the
  fact and still gives no real numbers or whole file.
