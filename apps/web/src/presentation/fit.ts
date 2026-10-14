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

/** What the deck measures before scaling a slide: the stage and the slide's natural size. */
export interface Measure {
  stage: Size;
  content: Size;
}

/** How far the content may move, in CSS pixels, before the slide is rescaled. */
const CONTENT_SLACK = 2;

/**
 * Whether a new measurement should change the slide's scale. The stage
 * changing always does. The content changing does only past a couple of
 * pixels: a content that answers a new scale by a pixel — rounding in
 * whatever measures itself on screen, where the scale applies — would ask
 * for the old scale back. The slide is then at most two pixels taller than
 * its scale accounts for, which the stage's padding absorbs.
 */
export function worthRescaling(previous: Measure | null, next: Measure): boolean {
  if (previous === null) return true;
  if (previous.stage.width !== next.stage.width || previous.stage.height !== next.stage.height) {
    return true;
  }
  return (
    Math.abs(previous.content.width - next.content.width) > CONTENT_SLACK ||
    Math.abs(previous.content.height - next.content.height) > CONTENT_SLACK
  );
}

/**
 * The scale to apply, given the scales already applied on this stage (oldest
 * first) and the one the new measurement asks for. A scale that comes back —
 * one applied before, other than the last — means the slide is answering its
 * own scale: something inside it changes size with the scale, and the flip
 * never ends by itself. Miguel saw it on the removal's code slide in Brave
 * (#322); it did not reproduce in Chromium at any window size tried, so the
 * guard does not depend on knowing what changes size. It settles at the
 * smallest scale seen, which fits every shape the slide took; asked again,
 * it answers the same, and nothing re-renders.
 */
export function settleScale(applied: readonly number[], asked: number): number {
  const before = applied.slice(0, -1);
  const comesBack = before.some((scale) => Math.abs(scale - asked) < 1e-4);
  return comesBack ? Math.min(asked, ...applied) : asked;
}
