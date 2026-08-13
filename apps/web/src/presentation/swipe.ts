/** A point on the screen, in client coordinates. */
export interface Point {
  x: number;
  y: number;
}

// Below this the movement is a tap that wobbled, not a swipe. 50 CSS px is
// ~7% of an iPhone 13's landscape width (750px, measured 2026-08-13): far more
// than a finger shifts while steadying the phone, far less than a deliberate
// flick. Lower it and a tap meant for the fullscreen control jumps a slide; a
// percentage of stage width was the cheaper alternative and is rejected — the
// same finger travels the same distance whatever the screen is.
const MIN_DISTANCE = 50;
// How much the horizontal component must beat the vertical one before the
// gesture counts as deliberate. A drag that is 120px across and 100px down is a
// smudge: acting on it moves the reader while they were doing something else.
// 1.5 is ~34 degrees off horizontal; an angle threshold computes the same thing
// through an atan2 and is rejected as arithmetic nobody reading this needs.
const HORIZONTAL_DOMINANCE = 1.5;

/**
 * Whether the touch landed on something that really scrolls sideways, up to
 * (and excluding) the stage. A code block wider than the slide is the case that
 * matters: on a phone the reader drags inside it to read the rest of the line,
 * and the deck used to take that drag and change the slide instead (#103,
 * measured on `/d/java-desde-cpp/present?slide=3` with 73px of Java hidden).
 * The reader gets the scroll; the deck keeps every other swipe.
 */
export function startsInsideHorizontalScroller(
  target: EventTarget | null,
  stage: Element,
): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== stage) {
    // Overflowing content is not the same as a scrollable box: a wrapper with
    // `overflow-x: visible` reports scrollWidth > clientWidth and cannot be
    // scrolled at all (measured in Chromium — scrollLeft stays 0 through both
    // an assignment and a real touch drag). Asking only about the numbers made
    // any slide containing a wide element — an svg, a canvas, a flex row, i.e.
    // what v0.2's visualisations produce — refuse the swipe across its whole
    // width. `hidden` is excluded on the DRAG half of that evidence only: it
    // does accept a scrollLeft assignment (measured: 30), so a round trip calls
    // it scrollable, while a real touch drag moves it 0px. It clips; it does
    // not pan — which is why this asks the computed value, not the numbers.
    const overflowX = getComputedStyle(node).overflowX;
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      // +1 absorbs sub-pixel rounding, which reports a 0.5px "overflow" on
      // boxes that do not scroll at all.
      node.scrollWidth > node.clientWidth + 1
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Which way a touch drag points, or null when it is not a slide gesture at all.
 * Pure on purpose: this is the half of the interaction the suite can judge.
 */
export function swipeDirection(start: Point, end: Point): 'next' | 'prev' | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < MIN_DISTANCE) return null;
  if (Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_DOMINANCE) return null;
  return dx < 0 ? 'next' : 'prev';
}
