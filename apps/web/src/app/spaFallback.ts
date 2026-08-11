import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * GitHub Pages is a static file server: a deep link like /nalanda/d/bienvenida
 * has no file behind it and would 404 before the SPA ever loads. Pages serves
 * 404.html for unknown paths, so shipping a copy of index.html under that name
 * hands the request to the router instead (issue #66).
 *
 * A Vite plugin rather than a `cp` in the build script: same behavior on every
 * OS and in CI, and it respects a configured outDir.
 */
export function spaFallback(): Plugin {
  let outDir = '';
  return {
    name: 'nalanda:spa-fallback',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // writeBundle, not closeBundle: closeBundle also runs when the build FAILS,
    // and the missing-index error would then replace the real root cause in the log.
    writeBundle() {
      const index = join(outDir, 'index.html');
      if (!existsSync(index)) {
        throw new Error(`SPA fallback: ${index} was not produced by the build`);
      }
      copyFileSync(index, join(outDir, '404.html'));
    },
  };
}
