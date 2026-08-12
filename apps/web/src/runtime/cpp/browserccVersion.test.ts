import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BROWSERCC_CDN, BROWSERCC_VERSION } from './browserccVersion';

const packageJson = join(dirname(fileURLToPath(import.meta.url)), '../../../package.json');

describe('browsercc version', () => {
  it('matches the installed package the types come from', () => {
    const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      devDependencies: Record<string, string>;
      dependencies: Record<string, string>;
    };

    // A bundled browsercc emits its 113MB toolchain into dist/ — it must stay a
    // devDependency, loaded from the CDN at runtime.
    expect(manifest.dependencies.browsercc).toBeUndefined();
    expect(manifest.devDependencies.browsercc?.replace(/^[\^~]/, '')).toBe(BROWSERCC_VERSION);
  });

  it('points the CDN at that same build', () => {
    expect(BROWSERCC_CDN).toContain(`browsercc@${BROWSERCC_VERSION}/`);
  });
});
