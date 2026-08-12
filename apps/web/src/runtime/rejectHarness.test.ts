import { describe, expect, it } from 'vitest';

import { rejectHarness } from './rejectHarness';

const request = { id: 1, source: 'print(1)', stdin: '' };

describe('rejectHarness', () => {
  it('lets an ordinary run through', () => {
    expect(() => rejectHarness(request, 'Python')).not.toThrow();
  });

  it('refuses a run carrying a harness', () => {
    // Running `source` alone would report a passing exercise that checked
    // nothing (ADR-0019 §4).
    expect(() => rejectHarness({ ...request, harness: 'class X {}' }, 'Python')).toThrow(
      /does not support exercises/,
    );
  });

  it('names the runtime that refused', () => {
    expect(() => rejectHarness({ ...request, harness: 'x' }, 'C++')).toThrow(/C\+\+/);
  });

  it('treats an empty harness as a harness', () => {
    // An exercise whose cases fence is empty is still an exercise; running the
    // student's file alone would be the same silent pass.
    expect(() => rejectHarness({ ...request, harness: '' }, 'Python')).toThrow();
  });
});
