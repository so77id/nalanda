import { describe, expect, it } from 'vitest';

import { fitScale } from './fit';

describe('fitScale', () => {
  it('leaves a slide that already fits alone', () => {
    expect(fitScale({ width: 1200, height: 800 }, { width: 896, height: 600 })).toBe(1);
  });

  it('never enlarges a small slide to fill a big screen', () => {
    expect(fitScale({ width: 2000, height: 1400 }, { width: 896, height: 300 })).toBe(1);
  });

  it('shrinks by the tighter of the two axes', () => {
    // Height is the scarce one on a phone in landscape; width is on a narrow
    // window. Taking the smaller ratio is what keeps BOTH inside the stage.
    expect(fitScale({ width: 800, height: 300 }, { width: 896, height: 600 })).toBeCloseTo(0.5);
    expect(fitScale({ width: 448, height: 900 }, { width: 896, height: 600 })).toBeCloseTo(0.5);
  });

  it('renders unscaled where nothing has been laid out', () => {
    // jsdom: every box is 0x0. A naive ratio would be 0 or NaN and the deck
    // would vanish in the suite while looking fine in a browser.
    expect(fitScale({ width: 0, height: 0 }, { width: 0, height: 0 })).toBe(1);
    expect(fitScale({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1);
  });

  it('answers 1 for an unmeasured stage rather than collapsing the slide', () => {
    // Each guard needs a case where the OTHER one cannot cover for it: with a
    // real content box, dropping the stage guard makes the ratio 0 and the deck
    // disappears (#99 review — the pair was mutually masking).
    expect(fitScale({ width: 0, height: 0 }, { width: 896, height: 600 })).toBe(1);
  });

  it('answers 1 for a detached content box rather than shrinking to fit nothing', () => {
    // A node removed from the DOM measures 0 on one axis while the other still
    // reads: without the content guard that is a 0.5 scale computed from a box
    // that is not on screen.
    expect(fitScale({ width: 800, height: 600 }, { width: 0, height: 1200 })).toBe(1);
  });
});
