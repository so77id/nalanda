import { describe, expect, it } from 'vitest';

import { INITIAL_FIT, fitScale, nextFit, settleScale, worthRescaling } from './fit';

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

describe('worthRescaling', () => {
  const at = (stageW: number, stageH: number, contentW: number, contentH: number) => ({
    stage: { width: stageW, height: stageH },
    content: { width: contentW, height: contentH },
  });

  it('rescales the first time a slide is measured', () => {
    expect(worthRescaling(null, at(1200, 800, 896, 1100))).toBe(true);
  });

  it('rescales whenever the stage changes, by any amount', () => {
    expect(worthRescaling(at(1200, 800, 896, 1100), at(1200, 799, 896, 1100))).toBe(true);
  });

  it('rescales when the content grows or shrinks for real', () => {
    // A stepper frame that adds a line to the narration, a widget that mounts.
    expect(worthRescaling(at(1200, 800, 896, 1100), at(1200, 800, 896, 1124))).toBe(true);
  });

  it('keeps the scale when the content only moves by a pixel or two', () => {
    // A code editor measures its lines on screen, where the scale applies,
    // and can answer a new scale with a listing a pixel taller — which asks
    // for the old scale back, and the slide flips between the two forever
    // (#322, Miguel's review: the removal's code slide shivered in Brave).
    expect(worthRescaling(at(1200, 800, 896, 1100), at(1200, 800, 896, 1101))).toBe(false);
    expect(worthRescaling(at(1200, 800, 896, 1100), at(1200, 800, 896, 1098))).toBe(false);
  });
});

describe('settleScale', () => {
  it('takes the scale it is given while the slide keeps finding new ones', () => {
    expect(settleScale([], 0.72)).toBe(0.72);
    expect(settleScale([0.72], 0.7)).toBe(0.7);
  });

  it('settles at the smaller scale when it comes back to one it already had', () => {
    // 0.72 → 0.70 → 0.72 → … is a slide answering its own scale: whatever
    // inside it changes size with the scale, the flip never ends by itself
    // (#322, the removal's code slide in Brave). The smaller one fits both.
    expect(settleScale([0.72, 0.7], 0.72)).toBe(0.7);
    expect(settleScale([0.72, 0.7, 0.71], 0.72)).toBe(0.7);
  });

  it('answers the same scale again once settled, so nothing re-renders', () => {
    expect(settleScale([0.72, 0.7, 0.7], 0.72)).toBe(0.7);
  });
});

describe('nextFit', () => {
  const at = (contentH: number, stageH = 800) => ({
    stage: { width: 1200, height: stageH },
    content: { width: 896, height: contentH },
  });

  function run(steps: [ReturnType<typeof at>, number][]): (number | null)[] {
    let state = INITIAL_FIT;
    return steps.map(([measure, now]) => {
      const result = nextFit(state, measure, now);
      if (result === null) return null;
      state = result.state;
      return Math.round(result.scale * 1000) / 1000;
    });
  }

  it('scales a slide the first time it is measured', () => {
    expect(run([[at(900), 0]])).toEqual([0.889]);
  });

  it('leaves the scale alone when the content moves by a pixel', () => {
    expect(
      run([
        [at(900), 0],
        [at(901), 16],
      ]),
    ).toEqual([0.889, null]);
  });

  it('settles a slide that flips between two scales frame after frame', () => {
    // The removal's code slide in Brave (#322): the content answers its own
    // scale, and the flip never ends by itself. The smaller scale fits both,
    // and once settled it is the answer every time — the same number, which
    // React does not re-render for.
    expect(
      run([
        [at(1111), 0],
        [at(1143), 16],
        [at(1111), 33],
        [at(1143), 50],
      ]),
    ).toEqual([0.72, 0.7, 0.7, 0.7]);
  });

  it('gives the slide its scale back when the content returns seconds later', () => {
    // «Ver solución» opens a panel and «Ocultar solución» closes it: the same
    // two heights, but a reader's clicks, not a loop. Settling here kept the
    // slide at the smaller scale while the reader stayed on it (#322 review).
    expect(
      run([
        [at(900), 0],
        [at(1100), 2000],
        [at(900), 4000],
      ]),
    ).toEqual([0.889, 0.727, 0.889]);
  });

  it('starts over when the stage changes', () => {
    expect(
      run([
        [at(1111), 0],
        [at(1143), 16],
        [at(1111, 700), 33],
      ]),
    ).toEqual([0.72, 0.7, 0.63]);
  });
});
