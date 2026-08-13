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
