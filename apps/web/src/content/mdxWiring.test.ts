import { describe, expect, it } from 'vitest';

import config from '../../vite.config';

/**
 * Proves the BUILD compiles markdown the way `mdxPipeline.test.tsx` proves the
 * plugin list does.
 *
 * These are two different failure modes and the second is the one that bit.
 * Extracting the list into `mdxPlugins.ts` moved the risk rather than removing
 * it: compiling through the exported array says nothing about what
 * `vite.config.ts` actually hands to `@mdx-js/rollup`. The first attempt guarded
 * that with `expect(config).toMatch(/mdx\(\{\s*remarkPlugins\b/)` over the
 * config's source text, which the review walked straight through — changing the
 * build to `remarkPlugins.filter(...)` dropped GFM, and lint, tsc, vite build and
 * all 347 tests stayed green while the shipped document chunk fell 3.3 kB and
 * every table in it turned back into a paragraph of pipes.
 *
 * A test that reads a config as text can prove a name appears. It cannot prove
 * the value is used. `testing-strategy.md` already said so; this resolves the
 * config and runs the plugin, which is what that section prescribes.
 */
async function transformMdx(source: string): Promise<string> {
  const resolved = await config({ command: 'build', mode: 'production' });
  const plugins = (resolved.plugins ?? []).flat() as {
    name?: string;
    transform?: (code: string, id: string) => Promise<{ code?: string; value?: string } | string>;
  }[];
  const mdxPlugin = plugins.find((plugin) => plugin?.name === '@mdx-js/rollup');
  expect(mdxPlugin?.transform, 'no @mdx-js/rollup plugin in the resolved config').toBeTypeOf(
    'function',
  );

  const out = await mdxPlugin!.transform!.call({}, source, '/probe/table.mdx');
  return typeof out === 'string' ? out : (out?.code ?? out?.value ?? '');
}

describe('what the build actually compiles', () => {
  it('turns a markdown table into a table', async () => {
    const compiled = await transformMdx('| a | b |\n|---|---|\n| 1 | 2 |\n');

    // MDX emits element names for the component map to resolve.
    expect(compiled).toContain('table');
    expect(compiled).toContain('thead');
  });

  it('keeps a fence meta, which is the other plugin nobody was pinning', async () => {
    const compiled = await transformMdx('```java starter\nint x = 1;\n```\n');

    expect(compiled).toContain('data-meta');
  });

  it('renders mathematics, which needs a plugin from each tree', async () => {
    const compiled = await transformMdx('Hay a lo más $\\log_2(n) + 1$ iteraciones.\n');

    // The failure this guards is asymmetric and worth naming. Dropping
    // `remarkMath` leaves the dollars as literal text; dropping `rehypeKatex`
    // leaves a math node nothing renders. Both look like "the formula did not
    // work" to an author and neither is visible to a config read as text —
    // which is the exact hole that let GFM fall out of the build.
    expect(compiled).toContain('katex');
    expect(compiled).not.toContain('$\\log_2');
  });

  it('compiled something real (guards against a vacuous check)', async () => {
    const compiled = await transformMdx('Sólo un párrafo.\n');

    expect(compiled).toContain('jsx');
    expect(compiled).not.toContain('thead');
    expect(compiled).not.toContain('katex');
  });
});
