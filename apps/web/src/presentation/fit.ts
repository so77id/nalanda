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
 * its scale accounts for; the stage pads only its sides and clips what
 * overflows, so at worst two pixels of the slide's bottom edge are cut.
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
 * The scale to apply, given the scales applied lately on this stage (oldest
 * first; `nextFit` keeps only the last half second of them) and the one the
 * new measurement asks for. A scale that comes back —
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

/** What the deck remembers between two measurements of the slide on screen. */
export interface FitState {
  /** The measurement the current scale was taken from. */
  last: Measure | null;
  /** The scales applied lately on this stage, oldest first, with when (ms). */
  applied: readonly { scale: number; at: number }[];
}

export const INITIAL_FIT: FitState = { last: null, applied: [] };

/**
 * How recent a scale must be, in milliseconds, to count as the slide
 * answering its own scale. Two cases fall outside it, accepted (#322
 * review, ADR-0013 §5.1): a panel opened and closed in under half a second
 * keeps the smaller scale, and a flip slower than half a second never
 * settles. A slide that flips does it frame after frame; a
 * reader opening and closing a panel («Ver solución», «Ocultar solución»)
 * brings back the same two heights seconds apart. Without the window that
 * click was taken for a flip and the slide stayed at the smaller scale while
 * the reader stayed on it (#322 review: 900 → 1100 → 900 px of content held
 * 0.727 where 0.889 fits).
 */
const SETTLE_WINDOW_MS = 500;

/**
 * The scale for a new measurement taken at `now` (ms), and what to remember
 * for the next one; `null` when the measurement does not warrant a rescale
 * (`worthRescaling`). A changed stage starts the memory over: the scales
 * applied on another stage say nothing about this one.
 */
export function nextFit(
  state: FitState,
  next: Measure,
  now: number,
): { state: FitState; scale: number } | null {
  const { last } = state;
  if (!worthRescaling(last, next)) return null;
  const stageMoved =
    last === null ||
    last.stage.width !== next.stage.width ||
    last.stage.height !== next.stage.height;
  const recent = (stageMoved ? [] : state.applied).filter(
    (applied) => now - applied.at <= SETTLE_WINDOW_MS,
  );
  const scale = settleScale(
    recent.map((applied) => applied.scale),
    fitScale(next.stage, next.content),
  );
  return { state: { last: next, applied: [...recent, { scale, at: now }] }, scale };
}
