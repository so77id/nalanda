/**
 * What the two trace modules of `<SequenceStepper>` share: how a frame names
 * the line it lights, and how an author-written argument becomes runs. A leaf
 * both import (#321 review, ARQ-6): the tree's module could not import them
 * from the dispatcher, which imports the tree's module, without closing a
 * cycle, and the copy it carried instead had already lost the reasons below.
 */

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
