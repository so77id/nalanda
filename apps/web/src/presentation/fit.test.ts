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
});
