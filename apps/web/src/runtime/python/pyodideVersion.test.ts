import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PYODIDE_CDN, PYODIDE_VERSION } from './pyodideVersion';

const packageJson = join(dirname(fileURLToPath(import.meta.url)), '../../../package.json');

describe('pyodide version', () => {
  it('matches the installed package the types come from', () => {
    const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    const declared = manifest.devDependencies.pyodide;

    // Types that describe a different build than the one we download are worse
    // than no types: they type-check a runtime we are not running.
    expect(declared).toBeDefined();
    expect(declared?.replace(/^[\^~]/, '')).toBe(PYODIDE_VERSION);
  });

  it('points the CDN at that same build', () => {
    expect(PYODIDE_CDN).toContain(`/v${PYODIDE_VERSION}/`);
  });
});
