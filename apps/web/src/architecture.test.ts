import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Architecture invariants from docs/standards/frontend-code-style.md:
// imports flow app → features → lib; lib imports nothing from above.
const SRC = dirname(fileURLToPath(import.meta.url));
const FEATURES = ['components', 'catalog', 'content', 'presentation'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function topSegmentOfImport(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // external package
  const target = resolve(dirname(file), spec);
  const rel = relative(SRC, target);
  if (rel.startsWith('..')) return null; // outside src
  return rel.split('/')[0] ?? null;
}

function violations(rule: (fileTop: string, importTop: string) => boolean): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const fileTop = relative(SRC, file).split('/')[0] ?? '';
    const source = readFileSync(file, 'utf8');
    // Covers `from '...'`, side-effect `import '...'`, and dynamic `import('...')`.
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const importTop = topSegmentOfImport(file, match[1] ?? '');
      if (importTop && rule(fileTop, importTop)) {
        found.push(`${relative(SRC, file)} imports from ${importTop}/`);
      }
    }
  }
  return found;
}

describe('architecture: import direction (app → features → lib)', () => {
  it('lib/ imports nothing from app/ or feature folders', () => {
    expect(
      violations(
        (fileTop, importTop) =>
          fileTop === 'lib' && (importTop === 'app' || FEATURES.includes(importTop)),
      ),
    ).toEqual([]);
  });

  it('feature folders import nothing from app/', () => {
    expect(
      violations((fileTop, importTop) => FEATURES.includes(fileTop) && importTop === 'app'),
    ).toEqual([]);
  });
});
