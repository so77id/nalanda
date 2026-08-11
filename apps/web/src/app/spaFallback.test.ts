import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedConfig } from 'vite';
import { describe, expect, it } from 'vitest';

import { spaFallback } from './spaFallback';

// The plugin is the whole mechanism keeping deep links alive on a static host,
// so it is unit-tested directly: driving the two hooks is cheaper and far more
// precise than asserting on a full build.
function drive(outDir: string, root: string, writeIndex: boolean) {
  const plugin = spaFallback();
  const dir = join(root, outDir);
  mkdirSync(dir, { recursive: true });
  if (writeIndex) writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');

  const configResolved = plugin.configResolved as (c: ResolvedConfig) => void;
  configResolved({ root, build: { outDir } } as unknown as ResolvedConfig);
  const writeBundle = plugin.writeBundle as () => void;
  return { run: () => writeBundle(), dir };
}

describe('spaFallback', () => {
  it('writes 404.html as a byte-identical copy of index.html', () => {
    const root = mkdtempSync(join(tmpdir(), 'spa-'));
    const { run, dir } = drive('dist', root, true);

    run();

    expect(readFileSync(join(dir, '404.html'), 'utf8')).toBe(
      readFileSync(join(dir, 'index.html'), 'utf8'),
    );
  });

  it('honors a non-default outDir', () => {
    const root = mkdtempSync(join(tmpdir(), 'spa-'));
    const { run, dir } = drive('build-output', root, true);

    run();

    expect(existsSync(join(dir, '404.html'))).toBe(true);
  });

  it('fails loudly when the build produced no index.html', () => {
    const root = mkdtempSync(join(tmpdir(), 'spa-'));
    const { run } = drive('dist', root, false);

    expect(run).toThrowError(/index\.html was not produced/);
  });

  it('runs on writeBundle, never on closeBundle (which also fires on failed builds)', () => {
    const plugin = spaFallback();
    expect(plugin.writeBundle).toBeDefined();
    expect(plugin.closeBundle).toBeUndefined();
  });
});
