import { describe, expect, it } from 'vitest';

import { swipeDirection } from './swipe';

// Pure geometry, so the suite CAN judge it — what jsdom cannot judge is whether
// a finger on a real screen produces these numbers, which is the browser check.
describe('swipeDirection', () => {
  it('reads a leftward drag as the next slide', () => {
    expect(swipeDirection({ x: 300, y: 200 }, { x: 200, y: 205 })).toBe('next');
  });

  it('reads a rightward drag as the previous slide', () => {
    expect(swipeDirection({ x: 200, y: 200 }, { x: 300, y: 195 })).toBe('prev');
  });

  it('ignores a drag too short to be a swipe', () => {
    // A tap wobbles. Advancing a slide on 20px would fire while the reader is
    // steadying the phone.
    expect(swipeDirection({ x: 200, y: 200 }, { x: 180, y: 200 })).toBeNull();
  });

  it('ignores a tap that does not move at all', () => {
    expect(swipeDirection({ x: 200, y: 200 }, { x: 200, y: 200 })).toBeNull();
  });

  it('ignores a vertical drag, however long', () => {
    // dx is deliberately over MIN_DISTANCE: with 5px the distance floor
    // rejected it first and this case proved nothing about the vertical rule
    // (#99 review).
    expect(swipeDirection({ x: 200, y: 500 }, { x: 260, y: 100 })).toBeNull();
  });

  it('ignores a diagonal drag where neither axis clearly wins', () => {
    // 120px across and 100px down is a smudge, not a decision: acting on it is
    // how a reader loses their place while trying to do something else.
    expect(swipeDirection({ x: 300, y: 200 }, { x: 180, y: 300 })).toBeNull();
  });
});
