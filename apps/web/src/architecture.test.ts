import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Architecture invariants from docs/standards/frontend-code-style.md:
// imports flow app → features → lib; lib imports nothing from above.
const SRC = dirname(fileURLToPath(import.meta.url));
const FEATURES = ['components', 'catalog', 'content', 'presentation', 'runtime'];
// The ONLY allowed cross-feature dependencies (frontend-code-style.md).
// Extending this map is an architectural decision — record it in the style doc.
const FEATURE_EDGES: Record<string, string[]> = {
  catalog: ['components'],
  components: ['presentation', 'runtime'],
  presentation: ['content'],
};

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

function violations(
  rule: (fileTop: string, importTop: string, importRel: string, file: string) => boolean,
): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const fileTop = relative(SRC, file).split('/')[0] ?? '';
    const source = readFileSync(file, 'utf8');
    // Covers `from '...'`, side-effect `import '...'`, and dynamic `import('...')`.
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1] ?? '';
      const importTop = topSegmentOfImport(file, spec);
      if (!importTop) continue;
      const importRel = relative(SRC, resolve(dirname(file), spec));
      if (rule(fileTop, importTop, importRel, relative(SRC, file))) {
        found.push(`${relative(SRC, file)} imports ${importRel}`);
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

describe('architecture: the code editor stays out of the entry chunk', () => {
  // The shell builds the MDX map and `catalogEntries` eagerly, so ANY static
  // import of the editor from a module the shell reaches drags CodeMirror into
  // the entry chunk — roughly doubling it, measured precisely in ADR-0018 §7.
  // Only the lazy wrapper may name it, with no per-file exemptions: an
  // allowlisted file is exactly where the next contributor would add the import
  // that reopens the hole.
  const ALLOWED = ['components/interactive/lazyCodeEditor.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          // Normalised hard, because every one of these resolves to the same
          // module and bundles the same way: `allowImportingTsExtensions` makes
          // `./CodeEditor.tsx` legal, `moduleResolution: "bundler"` also accepts
          // `./CodeEditor.js`, and macOS filesystems accept any casing. Listing
          // only the TS extensions left a hole wide enough to put CodeMirror
          // back in the entry chunk with the suite green (+105kB, measured).
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/codeeditor' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the exercise stays out of the entry chunk', () => {
  // Exercise embeds CodeMirror too, so it carries the same hazard as the editor
  // and gets its own case rather than sharing one — a single case covering both
  // would go green the moment either wrapper was the only importer.
  const ALLOWED = ['components/interactive/lazyExercise.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/exercise' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: cross-feature dependencies', () => {
  it('only the allowed feature edges exist in production code', () => {
    // Test files may exercise any feature through its seam (they are consumers,
    // like the shell); the edge allowlist constrains production structure.
    expect(
      violations(
        (fileTop, importTop, _importRel, file) =>
          !file.includes('.test.') &&
          FEATURES.includes(fileTop) &&
          FEATURES.includes(importTop) &&
          fileTop !== importTop &&
          !(FEATURE_EDGES[fileTop] ?? []).includes(importTop),
      ),
    ).toEqual([]);
  });

  it('cross-feature imports go through the feature root seam', () => {
    expect(
      violations(
        (fileTop, importTop, importRel) =>
          FEATURES.includes(importTop) &&
          fileTop !== importTop &&
          importRel.includes('/') &&
          importRel !== `${importTop}/index`,
      ),
    ).toEqual([]);
  });
});

// The two describes above guard the entry chunk by NAMING the heavy modules.
// That is per-component, and the invariant is per-graph: ADR-0018's claim is
// "no CodeMirror, no compiler, no runtime in the entry chunk", and #85 broke it
// without touching either name — `components/MdxPre` asked the runtime seam
// which languages exist, and the seam brought the registry, the descriptors and
// the Java launcher with it. Both allowlist tests stayed green while the eager
// payload went from 1 chunk / 503kB to 9 / 542kB.
describe('architecture: what the shell reaches eagerly', () => {
  /** Resolves an import specifier to a file inside src/, or null. */
  function moduleOf(fromFile: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null;
    const base = resolve(dirname(fromFile), spec);
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ]) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // not this one
      }
    }
    return null;
  }

  /**
   * Every module the shell's MDX map pulls in EAGERLY. A `lazy*.tsx` wrapper is
   * where the graph is cut on purpose (ADR-0018 §7), so the walk stops there —
   * that is exactly the boundary the invariant is about.
   */
  function eagerlyReachable(entry: string): Set<string> {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (/\/lazy[A-Z]\w*\.tsx$/.test(file)) continue; // the cut
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const next = moduleOf(file, match[1] ?? '');
        if (next) queue.push(next);
      }
    }
    return seen;
  }

  const reachable = eagerlyReachable(join(SRC, 'app/mdxComponents.ts'));

  it('reaches something at all (guards against a vacuous check)', () => {
    expect(reachable.size).toBeGreaterThan(5);
  });

  it('never reaches the runtime feature', () => {
    // Asking WHICH languages exist is fine and lives in lib/runtimeIds.ts;
    // reaching `runtime/` drags useRuntime, the registry, every descriptor and
    // the Java launcher into the payload every reader downloads.
    const offenders = [...reachable]
      .filter((file) => relative(SRC, file).startsWith('runtime/'))
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });

  it('never reaches CodeMirror or a language grammar', () => {
    const offenders = [...reachable]
      .filter((file) =>
        /@uiw\/react-codemirror|@codemirror\/|@lezer\//.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });
});
