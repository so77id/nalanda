import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import viteConfig from '../../vite.config';

// jsdom always sees BASE_URL='/', and no other test mounts <App/>, so the two
// things that only exist in the deployed build — the base path and the router
// basename — would otherwise regress silently and green (issue #66 review).
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function renderAppAt(path: string) {
  window.history.pushState({}, '', path);
  const { App } = await import('./App');
  render(<App />);
}

describe('deployed build shape', () => {
  it('builds under the Pages base path', () => {
    const config = viteConfig as unknown as (env: { command: string; mode: string }) => {
      base: string;
      plugins: unknown[];
    };

    expect(config({ command: 'build', mode: 'production' }).base).toBe('/nalanda/');
  });

  it('keeps the dev server at the root for short local URLs', () => {
    const config = viteConfig as unknown as (env: { command: string; mode: string }) => {
      base: string;
    };

    expect(config({ command: 'serve', mode: 'development' }).base).toBe('/');
  });

  it('emits the SPA fallback in the build pipeline', () => {
    const config = viteConfig as unknown as (env: { command: string; mode: string }) => {
      plugins: { name?: string }[];
    };
    const names = config({ command: 'build', mode: 'production' })
      .plugins.flat()
      .map((p) => p?.name);

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
