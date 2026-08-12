import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Code, Root } from 'mdast';
import { describe, expect, it } from 'vitest';

import { remarkCodeMeta } from './codeMeta';

function doc(code: Partial<Code>): Root {
  return { type: 'root', children: [{ type: 'code', value: 'x', ...code } as Code] };
}

function transform(tree: Root): Code {
  remarkCodeMeta()(tree);
  return tree.children[0] as Code;
}

describe('remarkCodeMeta', () => {
  it('keeps the info-string meta as a data attribute', () => {
    const node = transform(doc({ lang: 'java', meta: 'starter' }));
    expect(node.data?.hProperties).toMatchObject({ 'data-meta': 'starter' });
  });

  it('leaves a fence without meta untouched', () => {
    const node = transform(doc({ lang: 'java' }));
    expect(node.data?.hProperties).toBeUndefined();
  });

  it('ignores meta that is only whitespace', () => {
    const node = transform(doc({ lang: 'java', meta: '   ' }));
    expect(node.data?.hProperties).toBeUndefined();
  });

  it('trims the meta', () => {
    const node = transform(doc({ lang: 'java', meta: '  test  ' }));
    expect(node.data?.hProperties).toMatchObject({ 'data-meta': 'test' });
  });

  it('preserves hProperties another plugin already set', () => {
    const tree = doc({ lang: 'java', meta: 'starter' });
    (tree.children[0] as Code).data = { hProperties: { id: 'ya-estaba' } };
    const node = transform(tree);
    expect(node.data?.hProperties).toMatchObject({ id: 'ya-estaba', 'data-meta': 'starter' });
  });
});

// A plugin that is not registered transforms nothing. Removing `remarkCodeMeta`
// from the pipeline left the whole suite green while every exercise in the
// published document degraded to the author-error banner — the unit tests above
// drive the function directly and never notice.
//
// What each half now covers, since #83 moved the list out of `vite.config.ts`:
// `mdxPipeline.test.tsx` compiles real MDX through the exported list, so a
// plugin removed from `mdxPlugins.ts` fails there. This is the other failure
// mode — the list is fine but the build stops using it, which no amount of
// compiling through the list can see.
describe('registration in the MDX pipeline', () => {
  // vitest runs with apps/web as its cwd.
  const config = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');

  it('wires the shared plugin list into the MDX transform', () => {
    expect(config).toContain("from './src/content/mdxPlugins.ts'");
    expect(config).toMatch(/mdx\(\{\s*remarkPlugins\b/);
  });

  it('found a real config (guards against a vacuous check)', () => {
    expect(config).toContain('providerImportSource');
  });
});
