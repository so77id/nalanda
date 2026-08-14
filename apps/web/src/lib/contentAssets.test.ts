import { describe, expect, it } from 'vitest';

import { resolveAsset } from './contentAssets';

// A real committed content asset (the named fixture the búsqueda-binaria document
// draws): the eager import.meta.glob in contentAssets picks it up here exactly as
// it does in a build, so this exercises the real byKey wiring, not a stub.
const REAL_KEY = 'asset:courses/sample-course/costo-busqueda.svg';

describe('resolveAsset', () => {
  it('resolves an asset: key that names a committed file to its built url', () => {
    // Pins the byKey wiring end to end: the glob strips the leading `content/`
    // from every path and the lookup finds the file. A rename of the key, or a
    // broken prefix regex in the map, turns this null — mutation-detectable.
    const url = resolveAsset(REAL_KEY);
    expect(url).not.toBeNull();
    // The url carries a build-dependent prefix and query (`/@fs/…?no-inline` in
    // vitest, a hashed `/nalanda/assets/…` name in a real build), so match the
    // committed filename inside it rather than pinning the wrapper.
    expect(url).toContain('costo-busqueda.svg');
  });

  it('returns null for an asset: key with no file under content/', () => {
    // The caller (MdxImage/Figure) renders that visibly broken, the way an
    // unresolved wiki-link does — resolveAsset never fabricates a url.
    expect(resolveAsset('asset:courses/sample-course/does-not-exist.svg')).toBeNull();
  });

  it('leaves anything that is not an asset: reference alone', () => {
    // A literal path, an absolute url and an already-based url are all not ours;
    // resolveAsset only owns the `asset:` scheme remarkContentImages emits.
    expect(resolveAsset('./curva.svg')).toBeNull();
    expect(resolveAsset('https://example.com/x.svg')).toBeNull();
    expect(resolveAsset('/nalanda/favicon.svg')).toBeNull();
  });
});

// The `/nalanda/` base prefix on a resolved url is NOT assertable here, by
// construction: Vite bakes it into the `?url` import at BUILD time, and under
// vitest import.meta.env.BASE_URL is always '/' (testing-strategy.md, build-shape
// invariants — "a green jsdom suite says nothing about the deployed build"). It
// is pinned where it is decided: app/deployedApp.test.tsx asserts the resolved
// config base is '/nalanda/' for both build and preview, and content images ride
// the very same `?url` rewriting. This file pins the resolution wiring; that file
// pins the base; together they cover a base-url regression without a manual pass.
