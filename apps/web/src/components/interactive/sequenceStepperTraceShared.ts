/**
 * What the two trace modules of `<SequenceStepper>` share: how a frame names
 * the line it lights, how an author-written argument becomes runs, and how
 * many runs a slide may ask for. A leaf
 * both import (#321 review, ARQ-6): the tree's module could not import them
 * from the dispatcher, which imports the tree's module, without closing a
 * cycle, and the copy it carried instead had already lost the reasons below.
 */

import type { SequenceStep, SequenceTrace } from './sequenceStepperTrace';

/**
 * The 1-based line of the first line containing `fragment`.
 *
 * Every frame names the line it is executing by a piece of that line's TEXT,
 * never by a number. `lines` is unvalidated data — `CodeStepper` silently
 * drops an out-of-range number, so a wrong-but-in-range one survives the
 * build, the suite and the preview alike, and #277 shipped two of them,
 * both from renumbering by hand after re-wrapping a listing
 * (`teach-a-data-structure.md` §6bis). Looking the number up removes the
 * class: edit a listing and the frames follow, and a fragment that stops
 * existing throws here instead of lighting the wrong line.
 */
export function lineOf(code: string, fragment: string): number {
  const at = code.split('\n').findIndex((line) => line.includes(fragment));
  if (at < 0) throw new Error(`El listado no contiene «${fragment}».`);
  return at + 1;
}

/**
 * An author-written argument, read as the list of RUNS it asks for: one value
 * runs the operation once, an array runs it once per element over the same
 * structure. Everything the widget animates several times reads its arguments
 * through here, so the multi-run shape is one rule rather than one per
 * operation.
 */
export const asRuns = (v: number | number[] | undefined): number[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/**
 * The most times an author may ask for one operation. The chain-length guard
 * in the component counts cells, not RUNS, so `times={1e8}` used to allocate
 * its driving program before any guard could refuse it — measured: a heap
 * exhaustion that takes the tab down instead of printing an authoring error.
 * Every recipe asks it, the tree's search included (#321 review: a search for
 * thirteen values drew 198 frames before it did).
 */
const MAX_RUNS = 12;

export function requireRuns(runs: number): void {
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
    throw new Error(
      `La operación se ejecuta ${runs} veces. Entre 1 y ${MAX_RUNS}: más pasos de los que nadie sigue en una slide.`,
    );
  }
}

/**
 * What each line of one listing is in the other: a fragment of the traced
 * listing's line, and the fragments of the other listing's lines that do the
 * same thing — or a function of the frame, when which line depends on what
 * the frame drew (the side a new leaf hangs on).
 */
export type ListingPairs = [string, string[] | ((step: SequenceStep) => string[])][];

/**
 * Adds a second listing of the same operation to a trace (`alongside`), and
 * to every frame the lines of it that do what the frame's lines do. The
 * recursive and the iterative version of one operation make the same
 * decisions in the same order, so the frames are shared and only the lines
 * are translated. `otherFirst` makes the added listing the main one — the
 * array's binary search is traced iteratively but read recursive first.
 */
export function pairListings(
  trace: SequenceTrace,
  other: string,
  pairs: ListingPairs,
  otherFirst = false,
): SequenceTrace {
  const lines = trace.code.split('\n');
  const steps = trace.steps.map((step) => {
    const mapped = new Set<number>();
    for (const line of step.highlightLines) {
      const text = lines[line - 1] ?? '';
      const entry = pairs.find(([fragment]) => text.includes(fragment));
      if (entry === undefined) continue;
      const fragments = typeof entry[1] === 'function' ? entry[1](step) : entry[1];
      for (const fragment of fragments) mapped.add(lineOf(other, fragment));
    }
    const translated = [...mapped].sort((a, b) => a - b);
    return otherFirst
      ? { ...step, highlightLines: translated, alongsideLines: step.highlightLines }
      : { ...step, alongsideLines: translated };
  });
  return otherFirst
    ? { ...trace, code: other, alongside: trace.code, steps }
    : { ...trace, alongside: other, steps };
}
