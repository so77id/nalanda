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

  it('refuses a request carrying any UNKNOWN second-unit field', () => {
    // The shape check the JSDoc promises: adding a field to RunRequest that
    // this file did not learn about must throw, so a future second unit is
    // caught by construction rather than by remembering to add another `if`.
    // Cast because the point is that the guard catches shapes the type does
    // not yet cover.
    expect(() =>
      rejectHarness(
        { ...request, resource: 'x' } as unknown as Parameters<typeof rejectHarness>[0],
        'Python',
      ),
    ).toThrow(/resource/);
    expect(() =>
      rejectHarness(
        { ...request, library: 'public class NalandaTrace {}' } as unknown as Parameters<
          typeof rejectHarness
        >[0],
        'Python',
      ),
    ).toThrow(/library/);
  });

  it('ignores unknown fields that are undefined', () => {
    // Spread-with-optional-props is a common shape (`{...request, harness: harness}`
    // where `harness` may be undefined). The guard is about POPULATED extras.
    expect(() =>
      rejectHarness(
        { ...request, harness: undefined } as unknown as Parameters<typeof rejectHarness>[0],
        'Python',
      ),
    ).not.toThrow();
  });
});
