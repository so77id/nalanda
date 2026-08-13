import { describe, expect, it } from 'vitest';

import { startsInsideScroller, swipeDirection } from './swipe';

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

describe('startsInsideScroller', () => {
  // jsdom lays nothing out, so scrollWidth/clientWidth are stated rather than
  // measured; what is real here is the walk up the tree and where it stops.
  function box(scrollWidth: number, clientWidth: number) {
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollWidth', { value: scrollWidth });
    Object.defineProperty(element, 'clientWidth', { value: clientWidth });
    return element;
  }

  it('refuses a touch that starts inside a sideways-scrolling box', () => {
    const stage = box(800, 800);
    const code = box(900, 800);
    const line = box(0, 0);
    stage.append(code);
    code.append(line);

    expect(startsInsideScroller(line, stage)).toBe(true);
  });

  it('allows a touch on a box that merely happens to be wide', () => {
    const stage = box(800, 800);
    const slide = box(800, 800);
    stage.append(slide);

    expect(startsInsideScroller(slide, stage)).toBe(false);
  });

  it("stops at the stage, whose own overflow is the deck's business", () => {
    // The stage clips its slide by design (overflow-hidden); if the walk counted
    // it, every swipe on the deck would be refused.
    const stage = box(2000, 800);
    const slide = box(800, 800);
    stage.append(slide);

    expect(startsInsideScroller(slide, stage)).toBe(false);
  });

  it('ignores a target that is not an element', () => {
    expect(startsInsideScroller(null, box(800, 800))).toBe(false);
  });

  it('tolerates the sub-pixel rounding a browser reports on boxes that do not scroll', () => {
    const stage = box(800, 800);
    const rounded = box(801, 800);
    stage.append(rounded);

    expect(startsInsideScroller(rounded, stage)).toBe(false);
  });
});
