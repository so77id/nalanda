import { describe, expect, it } from 'vitest';

import { startsInsideHorizontalScroller, swipeDirection } from './swipe';

// Two halves of one question — is this touch the deck's? The geometry is pure
// and the suite judges it outright; the eligibility walk reads the DOM, and the
// suite can only judge WHICH nodes it visits, never what a browser would
// report about them. Both halves get a browser check (testing-strategy.md).
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

describe('startsInsideHorizontalScroller', () => {
  // jsdom lays nothing out, so the geometry is stated; what is real here is the
  // walk up the tree, where it stops, and which computed overflow it accepts.
  // Which of those the BROWSER agrees with is the browser check — a scrollLeft
  // round-trip, per testing-strategy.md.
  function box(scrollWidth: number, clientWidth: number, overflowX = 'auto') {
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollWidth', { value: scrollWidth });
    Object.defineProperty(element, 'clientWidth', { value: clientWidth });
    element.style.overflowX = overflowX;
    return element;
  }

  it('refuses a touch that starts inside a sideways-scrolling box', () => {
    const stage = box(800, 800);
    const code = box(900, 800);
    const line = box(0, 0);
    stage.append(code);
    code.append(line);
    document.body.append(stage);

    expect(startsInsideHorizontalScroller(line, stage)).toBe(true);
  });

  it('keeps the swipe over content that overflows a box nobody can scroll', () => {
    // The distinction the browser makes and the numbers do not: a wrapper with
    // `overflow-x: visible` reports scrollWidth > clientWidth and refuses to
    // scroll. Trusting the numbers alone would kill the swipe across any slide
    // holding a wide svg or canvas (#103 review, measured in Chromium).
    const stage = box(800, 800);
    const wrapper = box(1000, 716, 'visible');
    stage.append(wrapper);
    document.body.append(stage);

    expect(startsInsideHorizontalScroller(wrapper, stage)).toBe(false);
  });

  it('keeps the swipe over a box that clips without panning', () => {
    // `overflow-x: hidden` clips; it does not scroll. Measured the same way.
    const stage = box(800, 800);
    const clipped = box(1000, 800, 'hidden');
    stage.append(clipped);
    document.body.append(stage);

    expect(startsInsideHorizontalScroller(clipped, stage)).toBe(false);
  });

  it('lets a box that scrolls only up and down keep the swipe', () => {
    // The shape under the reader's thumb most often: an editor or an exercise
    // panel, tall and scrollable vertically. The gesture is horizontal, so it
    // is the deck's.
    const stage = box(800, 800);
    const tall = document.createElement('div');
    Object.defineProperty(tall, 'scrollWidth', { value: 800 });
    Object.defineProperty(tall, 'clientWidth', { value: 800 });
    Object.defineProperty(tall, 'scrollHeight', { value: 2000 });
    Object.defineProperty(tall, 'clientHeight', { value: 300 });
    tall.style.overflowY = 'auto';
    stage.append(tall);
    document.body.append(stage);

    expect(startsInsideHorizontalScroller(tall, stage)).toBe(false);
  });

  it("stops at the stage, whose own overflow is the deck's business", () => {
    const stage = box(2000, 800);
    const slide = box(800, 800);
    stage.append(slide);
    document.body.append(stage);

    expect(startsInsideHorizontalScroller(slide, stage)).toBe(false);
  });

  it('ignores a target that is not an element', () => {
    expect(startsInsideHorizontalScroller(null, box(800, 800))).toBe(false);
  });

  it('tolerates the sub-pixel rounding a browser reports on boxes that do not scroll', () => {
    const stage = box(800, 800);
    const rounded = box(801, 800);
    stage.append(rounded);
    document.body.append(stage);

    expect(startsInsideHorizontalScroller(rounded, stage)).toBe(false);
  });
});
