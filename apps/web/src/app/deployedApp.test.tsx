import { render, screen } from '@testing-library/react';
import type { ConfigEnv, UserConfig, UserConfigFnObject } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registry } from '../content';

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
  // Named, not positional (ADR-0025 §2). This read `walkIndex(courseIndex)[1]`,
  // which meant whatever the index happened to put second — so taking the
  // Fundamentos unit off the teaching path moved this case from a 1.4 kB
  // component-free document onto the 10 kB Java one without touching this file,
  // and it stayed green while testing something else. What the case needs is any
  // document that is not the landing page; `planificacion` is the smallest,
  // which also keeps it clear of the lazy-boundary hazards heavier documents
  // bring (#102).
  const DEEP_LINK_FIXTURE = 'planificacion';

  it('resolves a deep link that carries the base prefix', async () => {
    vi.stubEnv('BASE_URL', '/nalanda/');
    const entry = registry.get(DEEP_LINK_FIXTURE);
    expect(
      entry,
      `${DEEP_LINK_FIXTURE} left content/ — point this at another document that is not the landing page`,
    ).toBeDefined();
    const id = entry!.meta.id;
    const title = entry!.meta.title;

    await renderAppAt(`/nalanda/d/${id}`);

    // The title, not a bare level-1 heading: NotFound renders an h1 too, so a
    // generic assertion would pass even with the basename removed.
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });
});
