/** A point on the screen, in client coordinates. */
export interface Point {
  x: number;
  y: number;
}

// Below this the movement is a tap that wobbled, not a swipe.
const MIN_DISTANCE = 50;
// How much the horizontal component must beat the vertical one before the
// gesture counts as deliberate. A drag that is 120px across and 100px down is a
// smudge: acting on it moves the reader while they were doing something else.
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
