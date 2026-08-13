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
    // Test files are exempt, exactly as the edge rule above exempts them: they
    // are consumers like the shell. Without this, a test that needs a build-time
    // module forces the feature to EXPORT it — and #85 briefly put the remark
    // plugin list on `content/`'s browser-facing seam for one test's sake,
    // contradicting the rule that those plugins are never imported by browser
    // code (frontend-code-style.md).
    expect(
      violations(
        (fileTop, importTop, importRel, file) =>
          !file.includes('.test.') &&
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
   * Every module the browser evaluates before the first render, and every bare
   * package those modules pull in.
   *
   * The cut is the DYNAMIC import, not a filename. An earlier version of this
   * walk stopped at files matching `lazy*.tsx`, which is the same mistake it
   * was written to replace: adding a static `import { RUNTIME_IDS } from
   * '../../runtime'` INSIDE `lazyCodeEditor.tsx` passed all of these tests
   * while the eager payload grew 7.8 kB. `lazy(() => import('./X'))` is a
   * dynamic import; following static imports and never dynamic ones expresses
   * the boundary itself, and needs no naming convention to hold.
   */
  function eagerGraph(entry: string): { modules: Set<string>; packages: Set<string> } {
    const modules = new Set<string>();
    const packages = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (modules.has(file)) continue;
      modules.add(file);
      const source = readFileSync(file, 'utf8');
      // Two shapes reach the browser, and two deliberately do not:
      //   `import x from 'y'` / `export { x } from 'y'` / `import 'y'`  → followed
      //   `import type … from 'y'` → erased at build time
      //   `import('y')`            → the lazy cut
      const specs: string[] = [];
      for (const m of source.matchAll(
        /(?:^|[;\n])\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g,
      )) {
        if (!m[1]) specs.push(m[2] ?? '');
      }
      for (const m of source.matchAll(/(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) {
        specs.push(m[1] ?? '');
      }
      for (const spec of specs) {
        if (!spec.startsWith('.')) {
          if (!spec.endsWith('.css'))
            packages.add(
              spec
                .split('/')
                .slice(0, spec.startsWith('@') ? 2 : 1)
                .join('/'),
            );
          continue;
        }
        const next = moduleOf(file, spec);
        if (next) queue.push(next);
      }
    }
    return { modules, packages };
  }

  // Rooted at the real entry, not at the MDX map: the shell reaches the whole
  // catalog feature too, and an earlier version of this walk started at
  // `app/mdxComponents.ts` and covered 47 of 65 modules.
  const { modules, packages } = eagerGraph(join(SRC, 'app/main.tsx'));

  it('reaches something at all (guards against a vacuous check)', () => {
    expect(modules.size).toBeGreaterThan(20);
    expect(packages.size).toBeGreaterThan(3);
  });

  it('never reaches the runtime feature', () => {
    // Asking WHICH languages exist is fine and lives in lib/runtimeIds.ts;
    // reaching `runtime/` drags useRuntime, the registry, every descriptor and
    // the Java launcher into the payload every reader downloads.
    expect(
      [...modules]
        .filter((f) => relative(SRC, f).startsWith('runtime/'))
        .map((f) => relative(SRC, f)),
    ).toEqual([]);
  });

  /**
   * The packages that legitimately ship to a reader before first render.
   *
   * An ALLOWLIST, deliberately, not a denylist of the two things already known
   * to have broken. The previous version asserted "no `runtime/`, no
   * CodeMirror" and walked straight over a build-time markdown compiler:
   * `export { remarkPlugins }` on the content seam put remark-mdx-frontmatter
   * and its `toml` parser in the entry chunk (ADR-0018 §Consequences carries the
   * measurement) with every
   * architecture test green. Adding a package here is a deliberate act; it is
   * weight on the first paint of every page, including the ones with no code.
   */
  const SHIPS_EAGERLY = [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react-router-dom',
    '@mdx-js/react',
    'framer-motion',
    'lucide-react',
    'yaml',
  ];

  it('pulls in no package beyond what the first paint needs', () => {
    expect(
      [...packages].filter((name) => !SHIPS_EAGERLY.includes(name)).sort(),
      'this package now loads before the first paint of EVERY page, including the ' +
        'ones with no code. Do not add it to SHIPS_EAGERLY to go green — that is ' +
        'the same move as disabling a lint rule. Find what imports it eagerly and ' +
        'cut the graph there instead.',
    ).toEqual([]);
  });
});
