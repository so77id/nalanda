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

// Course documents (MDX) are the second source the palette guards below scan —
// an author can carry a className in a document without touching `src/`, and
// the walk above never reaches them (#109 review). Kept at module scope so
// the raw-colour ban and the JSX-walk alias guard read it from ONE place.
const CONTENT = join(SRC, '../../../content/courses');

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? mdxFiles(join(dir, e.name))
      : e.name.endsWith('.mdx')
        ? [join(dir, e.name)]
        : [],
  );
}

// The production surface both palette guards below scan: every `.ts`/`.tsx`
// under `src/` that is NOT a test file, plus every `.mdx` under `content/`.
// The `.test.` filter lives here rather than in each caller (#247 review).
function productionSources(): string[] {
  return [...walk(SRC).filter((f) => !relative(SRC, f).includes('.test.')), ...mdxFiles(CONTENT)];
}

// Strip `/* ... */` block comments and full-line `//` line comments before
// matching class-name-shaped patterns. Same recipe as the CodeMirror-theme
// case (this file, below): a class name in a comment matches the same regex
// as a class name in code and reads as a defect. Not a real comment parser:
// a TRAILING `// text-...` on a code line survives the strip (#247 review,
// CORR-2), which a proper tokeniser would fix but a naïve regex over the
// source cannot without eating `//` inside strings (URLs, template
// literals). The current tree does not trigger it — if a future line does,
// the guidance is to move the comment to its own line rather than pretend
// the strip is comprehensive.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// The Tailwind palette-family vocabulary the raw-colour ban forbids
// (`bg-slate-800`, `text-emerald-400`, ...). Named once so the two colour
// guards below share one source of truth: the raw-colour ban builds a regex
// alternation from it (`PALETTE_FAMILIES.join('|')`), and the JSX-walk
// alias guard uses the same set — plus `white`/`black` — to skip families
// that fail the OTHER guard with a better message. Extending this list is
// an architectural decision, same shape as `FEATURE_EDGES` above.
const RAW_FAMILY_NAMES = [
  'slate',
  'zinc',
  'gray',
  'neutral',
  'stone',
  'sky',
  'blue',
  'emerald',
  'green',
  'teal',
  'amber',
  'yellow',
  'orange',
  'red',
  'rose',
  'violet',
  'purple',
  'indigo',
  'cyan',
  'lime',
  'fuchsia',
  'pink',
] as const;

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
  // The shell builds the MDX map eagerly, so ANY static import of the editor from
  // a module the shell reaches drags CodeMirror into the entry chunk — roughly
  // doubling it, measured precisely in ADR-0018 §7. (It built `catalogEntries`
  // eagerly too when this was written; #122 put those behind a dynamic import —
  // see `never reaches the catalog entries` below — so a static import from a
  // `*.catalog.tsx` now costs the catalog's own chunk rather than the entry
  // chunk, and is forbidden for that reason instead.)
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

describe('architecture: the predict-output card stays out of the entry chunk', () => {
  // PredictOutput reaches the hazard both ways: it wraps LazyCodeEditor and it
  // imports the runtime seam through `useLoadedRuntime`. Either would have been
  // enough for its own case (see the two describes above); together they leave
  // no ambiguity about why the lazy wrapper is required. Same shape as the
  // other heavy-component guards above — a single ALLOWED entry, no
  // per-file exemptions.
  const ALLOWED = ['components/interactive/lazyPredictOutput.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/predictoutput' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the step-through widget stays out of the entry chunk', () => {
  // <StepShow> mounts a <CodeStepper> that imports CodeMirror + `useGrammar`
  // for syntax-coloured listings (matching the pattern every other `java` fence
  // gets through `<MdxPre>` since #85). That is the CodeMirror hazard the four
  // guards above cover, reached through this widget's route.
  //
  // ALLOWED covers the lazy wrapper AND the composite step widgets built on
  // top of StepShow. The composites (FibMemoSteps, FibTabSteps) statically
  // import StepShow so they can ship in the same chunk as their choreography,
  // and each one carries its OWN lazy wrapper (lazyFibMemoSteps /
  // lazyFibTabSteps) that keeps the whole chain out of the entry chunk. The
  // eager-graph walk below reads THIS list — extending it is a decision, not
  // a bypass.
  const ALLOWED = [
    'components/interactive/lazyStepShow.tsx',
    'components/interactive/FibMemoSteps.tsx',
    'components/interactive/FibTabSteps.tsx',
    'components/interactive/FibIterSteps.tsx',
  ];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/stepshow' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the benchmark widget stays out of the entry chunk', () => {
  // Benchmark reaches both hazards, exactly like PredictOutput: it wraps
  // LazyCodeEditor AND it imports the runtime seam through `useLoadedRuntime`.
  // Either would have been enough for its own case; together they leave no
  // ambiguity about why the lazy wrapper is required (ADR-0044). Same shape as
  // the other heavy-component guards — a single ALLOWED entry, no per-file
  // exemptions.
  const ALLOWED = ['components/interactive/lazyBenchmark.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/benchmark' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the mathplot widget stays out of the entry chunk', () => {
  // MathPlot pulls Nivo (@nivo/line), a chart library that reaches its own
  // React tree + a slice of d3 for scales / shapes / interpolation. Same
  // rationale as the other heavy components' guards (ADR-0046): a single
  // ALLOWED entry, no per-file exemptions.
  const ALLOWED = ['components/interactive/lazyMathPlot.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/mathplot' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the mermaid diagram stays out of the entry chunk', () => {
  // Mermaid drags dagre, d3 and a set of parsers into any chunk that imports
  // it (~200kB gzipped of mermaid-only chunks on the page, measured — ADR-0040
  // §Consequences; the library itself is ~600kB gzipped, §Alternatives) — a
  // payload in the same class as CodeMirror, so
  // it carries the same per-name case the four heavy components above carry,
  // with the same rationale: a single ALLOWED entry, no per-file exemptions.
  const ALLOWED = ['components/interactive/lazyMermaid.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/mermaid' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the complexityexercise widget stays out of the entry chunk', () => {
  // ComplexityExercise composes <CodeStepper> + <ComplexityCounter>: two
  // CodeMirror-adjacent widgets. Registering the real component eagerly in
  // the MDX map would pull both into the entry chunk of readers of pages
  // that mount no exercise. Same shape as the other heavy-component guards —
  // a single ALLOWED entry, no per-file exemptions.
  const ALLOWED = ['components/interactive/lazyComplexityExercise.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/complexityexercise' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the complexityhierarchy widget stays out of the entry chunk', () => {
  // ComplexityHierarchy is React + SVG only — no CodeMirror, no runtime.
  // Guarded here for pattern uniformity: every widget under `interactive/`
  // goes through its lazy wrapper, so a future extension (drill-in
  // animations, class-relative graphs) can add weight without moving the
  // seam. Same shape as the other heavy-component guards.
  const ALLOWED = ['components/interactive/lazyComplexityHierarchy.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/complexityhierarchy' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the binarysearchonarray widget stays out of the entry chunk', () => {
  // BinarySearchOnArray composes <CodeStepper> (CodeMirror + java grammar) plus
  // lucide icons for its controls. Registering the real component eagerly
  // would pull CodeMirror into the entry chunk of every reader of every page.
  // ADR-0059. Same shape as the other heavy-component guards — a single
  // ALLOWED entry, no per-file exemptions.
  const ALLOWED = ['components/interactive/lazyBinarySearchOnArray.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/binarysearchonarray' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the karatsubaviz widget stays out of the entry chunk', () => {
  // KaratsubaViz composes <CodeStepper> (CodeMirror + java grammar). Same
  // shape as the other lazy-widget guards. ADR-0062.
  const ALLOWED = ['components/interactive/lazyKaratsubaViz.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/karatsubaviz' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the closestpairviz widget stays out of the entry chunk', () => {
  // ClosestPairViz composes <CodeStepper> (CodeMirror + java grammar). Same
  // shape as the other lazy-widget guards. ADR-0061.
  const ALLOWED = ['components/interactive/lazyClosestPairViz.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/closestpairviz' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the maxsubarrayviz widget stays out of the entry chunk', () => {
  // MaxSubarrayViz composes <CodeStepper> (CodeMirror + java grammar) plus
  // lucide icons for its controls. Same shape as the other lazy-widget guards.
  // ADR-0060.
  const ALLOWED = ['components/interactive/lazyMaxSubarrayViz.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/maxsubarrayviz' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the callstack widget stays out of the entry chunk', () => {
  // CallStack composes <CodeStepper> (CodeMirror + java grammar) plus
  // lucide icons for its controls. Registering the real component eagerly
  // would pull CodeMirror into the entry chunk of every reader of every
  // page. ADR-0054. Same shape as the other heavy-component guards — a
  // single ALLOWED entry, no per-file exemptions.
  const ALLOWED = ['components/interactive/lazyCallStack.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/callstack' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the hanoiplayground widget stays out of the entry chunk', () => {
  // HanoiPlayground composes <CodeStepper> (CodeMirror + java grammar,
  // for the code panel above the towers) plus lucide icons and the
  // tower/disc animation glue. Registering the real component eagerly
  // would pull CodeMirror into the entry chunk of every reader. ADR-0055.
  const ALLOWED = ['components/interactive/lazyHanoiPlayground.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/hanoiplayground' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the fibmemosteps widget stays out of the entry chunk', () => {
  // FibMemoSteps composes <StepShow> (which itself pulls CodeStepper +
  // CodeMirror). It ships its own lazy wrapper AND appears in StepShow's
  // ALLOWED list so the composite chunk contains both. This block guards
  // the wrapper boundary — nobody else may import FibMemoSteps directly.
  const ALLOWED = ['components/interactive/lazyFibMemoSteps.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/fibmemosteps' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the fibtabsteps widget stays out of the entry chunk', () => {
  // Same rationale as FibMemoSteps: composite on top of StepShow, own
  // lazy wrapper + ALLOWED entry in the step-through guard above.
  const ALLOWED = ['components/interactive/lazyFibTabSteps.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/fibtabsteps' &&
          !file.includes('.test.') &&
          !ALLOWED.includes(file),
      ),
    ).toEqual([]);
  });
});

describe('architecture: the fibitersteps widget stays out of the entry chunk', () => {
  // Same rationale as FibMemoSteps: composite on top of StepShow, own
  // lazy wrapper + ALLOWED entry in the step-through guard above.
  const ALLOWED = ['components/interactive/lazyFibIterSteps.tsx'];

  it('is imported only by its lazy wrapper', () => {
    expect(
      violations(
        (_fileTop, _importTop, importRel, file) =>
          importRel.toLowerCase().replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '') ===
            'components/interactive/fibitersteps' &&
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

/**
 * Resolves an import specifier to a file inside src/, or null.
 *
 * The `.js` stripping is not cosmetic, and it is the second time this repo has
 * paid for it. `moduleResolution: "bundler"` accepts `./grammar.js` for a file
 * that is `grammar.ts` on disk, so a specifier written that way resolved to
 * nothing here — and a walk that cannot resolve a module silently stops there,
 * taking every package behind it with it. Found by a review recheck (#122) with
 * `import { grammar } from './grammar.js'` in a runtime module: `tsc` green, all
 * 17 architecture cases green, and the built java chunk statically importing a
 * 40.7 kB grammar. It truncated BOTH walks — the runtime allowlist and the
 * shell's `SHIPS_EAGERLY` case. The `CodeEditor` guard 100 lines above already
 * normalises for exactly this ("`moduleResolution: "bundler"` also accepts
 * `./CodeEditor.js`"); the lesson was written down and not applied one function
 * over.
 */
function moduleOf(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec).replace(/\.(js|jsx|mjs|cjs)$/, '');
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

// The two describes above guard the entry chunk by NAMING the heavy modules.
// That is per-component, and the invariant is per-graph: ADR-0018's claim is
// "no CodeMirror, no compiler, no runtime in the entry chunk", and #85 broke it
// without touching either name — `components/MdxPre` asked the runtime seam
// which languages exist, and the seam brought the registry, the descriptors and
// the Java launcher with it. Both allowlist tests stayed green while the eager
// payload went from 1 chunk / 503kB to 9 / 542kB.
describe('architecture: what the shell reaches eagerly', () => {
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

  it('never reaches the catalog entries', () => {
    // The entries are documentation ADDRESSED TO COMPONENT AUTHORS — descriptions,
    // when-to-use, prop tables, example snippets — and only /catalog reads them.
    // Reached eagerly they ride in the payload of every course page, including
    // documents nobody will ever open the catalog from. ADR-0018 §Consequences
    // carries the measurement; it is not repeated here, because it MOVES — which
    // is the whole reason this is a guard rather than a number in a document. It
    // more than doubled in the four WPs between #116 noticing it and #122 fixing
    // it, with nothing to notice.
    expect(
      [...modules]
        .map((f) => relative(SRC, f))
        .filter((f) => f === 'components/catalogEntries.ts' || f.includes('.catalog.'))
        .sort(),
      'the catalog entries are reachable before first paint again — they belong behind ' +
        '`loadCatalogEntries()` on the components seam, not in a static import',
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

describe('architecture: a runtime carries no editor', () => {
  // `loadRuntime(id)` is the compiler half of a language — a worker factory and a
  // descriptor. `loadGrammar(id)` is the editor half. They are two entry points
  // because two consumers genuinely need one without the other. The historical
  // worked case (retired in #209, the ADR superseding 0028): a memory-diagram
  // widget drove a real JVM and drew its own listing, so while the grammar
  // sat inside the runtime module it paid a full highlighter to render none
  // (#122). The widget is gone; the split stays useful for the next non-editor
  // runtime consumer.
  //
  // A source walk rather than a size assertion: the kilobytes are the symptom and
  // only a build can see them, but a static import is the cause and it is visible
  // here — the same reasoning ADR-0018 §Consequences reaches about the entry chunk.
  //
  // **An ALLOWLIST, and the same walker the shell's guard uses**, both learned the
  // hard way in review. The first version of this case was a second, weaker walker
  // that denied one hard-coded prefix, and it was evaded three ways while staying
  // green: a grammar imported from `runtime/registry.ts` (never a root — and the
  // file `guides/add-a-language-runtime.md` now sends the next author to edit), a
  // `.tsx` module in a language folder (the resolver tried only `.ts`), and a bare
  // side-effect `import './x'` (the regex required a `from`). Each of those put a
  // ~40 kB grammar chunk back into a language chunk. Denying a list of known-bad
  // names is the move ADR-0018 already records as insufficient for the entry
  // chunk; the answer there was an allowlist over a shared walk, and it is the
  // answer here.
  const RUNTIME_ROOTS = ['index.ts', 'registry.ts'];

  /**
   * What the runtime feature's STATIC graph may legitimately reach.
   *
   * One package, and that is not an accident worth loosening: a runtime module is
   * a worker factory and a descriptor, and `useRuntime` is a React hook. Anything
   * else — a grammar from any vendor, a toolchain, a parser — belongs behind one
   * of the feature's dynamic entry points. Adding a name here is a deliberate act
   * that puts weight on every consumer of every language, including the ones that
   * mount no editor.
   */
  const RUNTIME_MAY_REACH = ['react'];

  function runtimeRoots(): string[] {
    const dir = join(SRC, 'runtime');
    const inFolders = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => [join(dir, e.name, 'index.ts'), join(dir, e.name, 'index.tsx')]);
    return [...RUNTIME_ROOTS.map((f) => join(dir, f)), ...inFolders].filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    });
  }

  it('resolves a `.js` specifier, which the compiler accepts for a .ts file', () => {
    // The resolver IS the walk: an unresolvable specifier is a silent stop, and
    // everything behind it disappears from both allowlists. `bundler` resolution
    // makes `./grammar.js` legal for `grammar.ts`, and a review recheck put a
    // 40.7 kB grammar back into the java chunk through exactly that spelling with
    // every case green. Asserted directly rather than through a fixture, because
    // the defect is in one line of one function.
    const from = join(SRC, 'runtime/java/index.ts');
    expect(moduleOf(from, './grammar.js')).toBe(join(SRC, 'runtime/java/grammar.ts'));
    expect(moduleOf(from, './grammar')).toBe(join(SRC, 'runtime/java/grammar.ts'));
    expect(moduleOf(from, '../registry.js')).toBe(join(SRC, 'runtime/registry.ts'));
  });

  it('finds the runtime modules (guards against a vacuous walk)', () => {
    // Without this the allowlist case below passes over an empty root set, which
    // is how a guard stops guarding without anyone noticing.
    const roots = runtimeRoots().map((f) => relative(SRC, f));
    expect(roots).toContain('runtime/registry.ts');
    expect(roots).toContain('runtime/index.ts');
    expect(roots.filter((f) => /^runtime\/[^/]+\/index\.tsx?$/.test(f)).length).toBeGreaterThan(2);
  });

  it('pulls in no package beyond what driving a runtime needs', () => {
    const reached = new Set<string>();
    for (const root of runtimeRoots()) {
      for (const name of eagerGraph(root).packages) reached.add(name);
    }
    expect(
      [...reached].filter((name) => !RUNTIME_MAY_REACH.includes(name)).sort(),
      'this package is now reachable from a runtime module by a STATIC import, so ' +
        'every consumer of that language pays for it — an author of a future ' +
        'non-editor consumer (e.g. a call-stack visualiser) will inherit that cost. ' +
        'A CodeMirror grammar goes behind `loadGrammar(id)`. ' +
        'Do not add it to RUNTIME_MAY_REACH to go green: that is the same move as ' +
        'widening SHIPS_EAGERLY, and #122 exists because this exact weight was ' +
        'travelling unnoticed.',
    ).toEqual([]);
  });
});

describe('architecture: colour goes through the palette', () => {
  // #109, ADR-0026. Every colour in the product is a semantic token, so a raw
  // Tailwind colour class in production code is a component that will be wrong
  // in one of the two themes — and wrong invisibly, because nothing in a jsdom
  // suite can see a colour. The light theme shipped broken past a fully green
  // gate exactly once during this WP; this case is what stops the second time.
  //
  // Tests are exempt: several assert the token a component takes, and naming a
  // colour there is the point rather than the defect.
  // Course documents are JSX and can carry className, so an author can break the
  // light theme from `content/` without touching `src/` — and the walk above
  // never reaches them (#109 review). They are published, so this is the same
  // rule, not a stricter one. `productionSources()` covers both surfaces.
  const PROPS =
    'bg|text|border|ring|outline|divide|decoration|placeholder|from|via|to|shadow|accent|caret|fill|stroke';
  // Three shapes, because the codebase can express three and the first version
  // of this guard only caught one (#109 review):
  //   1. a numbered family      bg-slate-800
  //   2. bare white/black       text-white, bg-black/40  ← the class index.css
  //      names as the whole reason `on-keep` exists
  //   3. an arbitrary value     border-[#0c1118], text-[rgb(...)]
  // `text-[0.8em]` and friends must NOT match, so shape 3 requires a colour
  // opener rather than any bracket.
  const RAW_COLOUR = new RegExp(
    String.raw`\b(?:${PROPS})-(?:(?:${RAW_FAMILY_NAMES.join('|')})-\d{2,3}|white|black)(?:\/\d{1,3})?\b` +
      String.raw`|\b(?:${PROPS})-\[\s*(?:#|rgba?\(|hsla?\(|oklch\(|color-mix\()`,
    'g',
  );

  function rawColours(): string[] {
    const found: string[] = [];
    for (const file of productionSources()) {
      const label = relative(SRC, file).replace(/^(\.\.\/)+/, '');
      for (const hit of new Set(readFileSync(file, 'utf8').match(RAW_COLOUR) ?? [])) {
        found.push(`${label}: ${hit}`);
      }
    }
    return found;
  }

  it('no production file names a raw Tailwind colour', () => {
    expect(
      rawColours(),
      'use a semantic token (docs/standards/design-system.md). A raw colour is right in at most one theme, and no test can see which.',
    ).toEqual([]);
  });

  it('finds files to check (guards against a vacuous scan)', () => {
    // The regex is the whole check; if the walk ever returns nothing, the case
    // above passes while scanning zero files. Assert the scan reaches the app.
    expect(walk(SRC).length, 'the source walk found nothing — repoint SRC').toBeGreaterThan(20);
    expect(
      mdxFiles(CONTENT).length,
      'no course documents found — repoint CONTENT, or the ban silently stopped covering them',
    ).toBeGreaterThan(0);
  });

  it('the pattern still matches a known-bad sample', () => {
    // The regex IS the guard, so a regex that silently stops matching is a guard
    // that silently stops guarding — and the case above would go green over a
    // codebase full of raw colours. Sample every shape the ban covers.
    for (const bad of [
      'bg-slate-800',
      'text-emerald-400',
      'text-white',
      'bg-black/40',
      'border-[#0c1118]',
      'text-[rgb(12,17,24)]',
    ]) {
      expect(new RegExp(RAW_COLOUR.source).test(bad), `${bad} is no longer caught`).toBe(true);
    }
    // …and does not fire on the shapes that are legal.
    for (const good of ['text-ink-faint', 'bg-keep-soft', 'text-[0.8em]', 'max-w-3xl']) {
      expect(new RegExp(RAW_COLOUR.source).test(good), `${good} is wrongly flagged`).toBe(false);
    }
  });

  // No CodeMirror may pin its own theme. It takes the theme as a prop rather
  // than reading the cascade, so a literal here is a dark editor inside a light
  // panel — and neither guard above can see it: a string prop is not a colour
  // class, and jsdom renders no colour at all. #109 shipped exactly that in
  // `Exercise.tsx` while `CodeEditor.tsx` was migrated, and the entire suite
  // stayed green over it. This is the case that would have caught it.
  it('no component hardcodes a CodeMirror theme', () => {
    const pinned: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel.includes('.test.')) continue;
      // Comments stripped first: this very rule is DESCRIBED in a comment in
      // useResolvedTheme.ts, and scanning raw text flags the explanation of the
      // defect as the defect.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
      if (/theme=(?:"|')(?:light|dark)(?:"|')/.test(code)) pinned.push(rel);
    }
    expect(
      pinned,
      'pass `theme={useResolvedTheme()}` instead — a pinned theme is correct in one theme and wrong in the other, and nothing else in the suite can see it',
    ).toEqual([]);
  });
});

describe('architecture: every colour class resolves to a registered palette token', () => {
  // #247. The raw-colour ban above stops a component from naming a Tailwind
  // family (`bg-slate-800`, `text-white`). But it cannot see the *inverse*
  // defect: a component that reaches for a SEMANTIC token which was renamed,
  // typo'd, or never registered — `text-ink-fain`, `bg-accent-poop`, a
  // resurrected `--color-brand-primary` after the palette moved on. Tailwind
  // silently drops the class (no `--color-<name>` alias in @theme, no
  // stylesheet rule generated) and the element paints nothing. jsdom cannot
  // see paint, so the whole suite stays green over a colourless button.
  //
  // This case reads the SET of declared tokens out of `styles/index.css`
  // (the same @theme block `palette.test.ts` reads for its contract) and
  // fails when a `text-|bg-|border-|ring-|outline-|divide-|fill-|stroke-|
  // placeholder-|accent-` class names anything else. False positives — every
  // Tailwind non-colour utility that shares a prefix (`text-xs`, `bg-cover`,
  // `border-solid`, `ring-2`, `outline-offset`, ...) — go through
  // `NON_COLOUR_STARTERS` and the numeric guard, both narrow because ADR-0026
  // forbids raw palette names in the same prefixes.
  //
  // The raw-colour ban owns family names (`slate`, `emerald`, ...) so we do
  // not repeat that vocabulary here — a raw hit fails the OTHER case with a
  // better message. This case owns the palette-only vocabulary.

  const CSS = readFileSync(join(SRC, 'styles/index.css'), 'utf8');
  const themeBlock = /@theme\s*\{([\s\S]*?)\n\}/m.exec(CSS);
  const declared = new Set<string>();
  if (themeBlock) {
    for (const [, name] of themeBlock[1]!.matchAll(/--color-([a-z][a-z0-9-]*):/g)) {
      declared.add(name!);
    }
  }

  // The first segment of a Tailwind class token that names a NON-COLOUR
  // utility on one of the colour-shaped prefixes. Kept small and stable
  // because we own the palette vocabulary and raw families are already
  // banned — the only reason this list exists is that Tailwind reuses
  // `text-|bg-|border-|...` for sizes, alignment, and styles.
  const NON_COLOUR_STARTERS = new Set<string>([
    // typography sizes (`text-xs` ... `text-9xl`, plus the local `2xs`/`3xs`)
    'xs',
    '2xs',
    '3xs',
    'sm',
    'base',
    'lg',
    'xl',
    '2xl',
    '3xl',
    '4xl',
    '5xl',
    '6xl',
    '7xl',
    '8xl',
    '9xl',
    // alignment / wrap / transform
    'left',
    'right',
    'center',
    'justify',
    'start',
    'end',
    'nowrap',
    'wrap',
    'balance',
    'pretty',
    // border sides
    't',
    'r',
    'b',
    'l',
    'x',
    'y',
    's',
    'e',
    // border/outline/divide styles
    'solid',
    'dashed',
    'dotted',
    'double',
    'hidden',
    'none',
    'collapse',
    'separate',
    'reverse',
    // ring / outline extras
    'inset',
    'offset',
    // background utilities that share the prefix
    'cover',
    'contain',
    'fixed',
    'local',
    'scroll',
    'top',
    'bottom',
    'auto',
    'clip',
    'no',
    'origin',
    'repeat',
    // fill/stroke helpers
    'current',
    'inherit',
    'transparent',
    'width',
  ]);

  const CLASS_RE =
    /\b(text|bg|border|ring|outline|divide|fill|stroke|placeholder|accent)-([a-z][a-z0-9-]*)\b/g;

  // Some raw families would still land here (`slate`, `emerald`, ...); the
  // raw-colour ban above catches those with a clearer message, so we do not
  // re-flag them. Derived from RAW_FAMILY_NAMES (module scope) plus
  // `white`/`black` — one vocabulary, two shapes.
  const RAW_COLOUR_FIRST_SEGMENTS = new Set<string>([...RAW_FAMILY_NAMES, 'white', 'black']);

  function classify(token: string): 'declared' | 'non-colour' | 'unknown' {
    if (declared.has(token)) return 'declared';
    const first = token.split('-')[0]!;
    if (NON_COLOUR_STARTERS.has(first)) return 'non-colour';
    if (/^\d/.test(first)) return 'non-colour';
    if (RAW_COLOUR_FIRST_SEGMENTS.has(first)) return 'non-colour';
    return 'unknown';
  }

  function unregisteredTokens(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const file of productionSources()) {
      const source = stripComments(readFileSync(file, 'utf8'));
      const label = relative(SRC, file).replace(/^(\.\.\/)+/, '');
      for (const match of source.matchAll(CLASS_RE)) {
        const token = match[2]!;
        if (classify(token) !== 'unknown') continue;
        if (!out.has(token)) out.set(token, new Set());
        out.get(token)!.add(label);
      }
    }
    return out;
  }

  it('reads at least one --color-<name> declaration out of the @theme block', () => {
    // The whole check hinges on `declared` being populated. If the regex
    // ever stops matching, every unknown token silently classifies as
    // 'declared' (empty set never rejects) and the case below passes
    // vacuously over a broken palette. Assert non-vacuity here.
    expect(
      declared.size,
      'no --color-<name> declarations extracted from styles/index.css @theme block',
    ).toBeGreaterThan(5);
    // The core semantic tokens must be present — a bulwark against a
    // future regex-refactor that harvests something else.
    for (const name of ['ink', 'ground', 'accent-pop', 'rule-strong']) {
      expect(declared, `${name} missing from extracted palette`).toContain(name);
    }
  });

  it('every colour-shaped class in src/ and content/ resolves to --color-<name>', () => {
    const unknown = unregisteredTokens();
    expect(
      [...unknown.entries()].map(([tok, files]) => `${tok} (${[...files].join(', ')})`),
      'colour-shaped class names a token that is not declared as --color-<name> in styles/index.css @theme block. Register it there (with a value under both themes), or fix the typo.',
    ).toEqual([]);
  });

  it('catches an unregistered token (guards against a silent-passing check)', () => {
    // The check IS the test; if `classify` ever stops flagging, the case
    // above passes over a broken codebase. Prove the regex + classifier
    // still catch the shape we care about.
    for (const token of ['nonexistent-palette-token', 'brand-primary', 'ink-fain']) {
      expect(classify(token), `${token} should classify as unknown`).toBe('unknown');
    }
    // …and does not fire on the known-good shapes.
    for (const token of [
      'ink',
      'accent-pop',
      'rule-strong',
      'xs',
      'lg',
      'left',
      'solid',
      'none',
      'b',
      'b-0',
      'offset-2',
      'slate-800',
    ]) {
      expect(classify(token), `${token} should NOT classify as unknown`).not.toBe('unknown');
    }
  });
});
