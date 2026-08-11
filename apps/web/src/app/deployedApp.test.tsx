import { render, screen } from '@testing-library/react';
import type { ConfigEnv, UserConfig, UserConfigFnObject } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import viteConfig from '../../vite.config';

// jsdom always sees BASE_URL='/', and no other test mounts <App/>, so the three
// things that only exist outside dev — the built base, the preview base and the
// router basename — would otherwise regress silently and green (issue #66).
// Vite's own ConfigEnv, not a hand-written shape: the partial cast this file
// first used is what hid `isPreview` from view in the first place.
const config = viteConfig as UserConfigFnObject;
const resolve = (env: ConfigEnv): UserConfig => config(env) as UserConfig;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  // pushState mutates history for the whole file; without this the next test
  // starts on a prefixed URL with the basename already restored to ''.
  window.history.pushState({}, '', '/');
});

async function renderAppAt(path: string) {
  window.history.pushState({}, '', path);
  const { App } = await import('./App');
  render(<App />);
}

describe('deployed build shape', () => {
  it('builds under the Pages base path', () => {
    expect(resolve({ command: 'build', mode: 'production' }).base).toBe('/nalanda/');
  });

  it('previews under the Pages base path too', () => {
    // preview serves the built dist, whose asset URLs already carry the prefix;
    // serving it at '/' answers every bundle with index.html (the COR-1 bug).
    expect(resolve({ command: 'serve', mode: 'production', isPreview: true }).base).toBe(
      '/nalanda/',
    );
  });

  it('keeps the dev server at the root for short local URLs', () => {
    expect(resolve({ command: 'serve', mode: 'development' }).base).toBe('/');
  });

  it('emits the SPA fallback in the build pipeline', () => {
    const plugins = resolve({ command: 'build', mode: 'production' }).plugins ?? [];
    const names = plugins.flat().map((p) => (p as { name?: string } | null)?.name);

    expect(names).toContain('nalanda:spa-fallback');
  });
});

describe('App under a deployed base path', () => {
  it('resolves a deep link that carries the base prefix', async () => {
    vi.stubEnv('BASE_URL', '/nalanda/');
    const id = walkIndex(courseIndex)[1]!;
    const title = registry.get(id)!.meta.title;

    await renderAppAt(`/nalanda/d/${id}`);

    // The title, not a bare level-1 heading: NotFound renders an h1 too, so a
    // generic assertion would pass even with the basename removed.
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });
});
