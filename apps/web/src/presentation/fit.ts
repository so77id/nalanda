/** Size of a box, in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * How much a slide must shrink to fit the stage it is shown on. Never enlarges:
 * a slide designed at desktop size is the reference, and a bigger screen shows
 * it at its own size rather than blown up.
 *
 * Returns 1 for a stage or content the browser has not laid out yet (every box
 * is 0×0 in jsdom), so the deck renders unscaled instead of collapsing.
 */
export function fitScale(stage: Size, content: Size): number {
  if (stage.width <= 0 || stage.height <= 0) return 1;
  if (content.width <= 0 || content.height <= 0) return 1;
  return Math.min(1, stage.width / content.width, stage.height / content.height);
}
