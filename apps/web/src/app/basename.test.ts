import { describe, expect, it } from 'vitest';

import { routerBasename } from './basename';

describe('routerBasename', () => {
  it('is empty in dev, where the app is served from the domain root', () => {
    expect(routerBasename('/')).toBe('');
  });

  it('drops the trailing slash of a deployed base path', () => {
    // Vite's BASE_URL always ends in '/', react-router's basename must not.
    expect(routerBasename('/nalanda/')).toBe('/nalanda');
  });

  it('leaves an already-trimmed base untouched', () => {
    expect(routerBasename('/nalanda')).toBe('/nalanda');
  });

  it('handles a multi-segment base', () => {
    expect(routerBasename('/a/b/')).toBe('/a/b');
  });
});
