import { describe, expect, it } from 'vitest';

import { componentCount } from './componentCount';

describe('componentCount', () => {
  it('agrees with the number instead of hedging with "(s)"', () => {
    expect(componentCount(1)).toBe('1 component');
    expect(componentCount(2)).toBe('2 components');
    expect(componentCount(11)).toBe('11 components');
  });

  it('says none in words, because "0 components" is a count and this is a state', () => {
    expect(componentCount(0)).toBe('no components');
  });
});
