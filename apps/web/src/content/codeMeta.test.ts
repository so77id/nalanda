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
describe('registration in the MDX pipeline', () => {
  // vitest runs with apps/web as its cwd.
  const config = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
  // Delimited by what follows the array, not by the first ']': the list holds
  // a nested [plugin, options] pair, and stopping there cut it in half.
  const remarkList = config.slice(
    config.indexOf('remarkPlugins:'),
    config.indexOf('providerImportSource'),
  );

  it('registers remarkCodeMeta', () => {
    expect(remarkList).toContain('remarkCodeMeta');
  });

  it('registers remarkWikiLinks, which was equally unpinned', () => {
    expect(remarkList).toContain('remarkWikiLinks');
  });

  it('found a real plugin list (guards against a vacuous check)', () => {
    expect(remarkList).toContain('remarkFrontmatter');
  });
});
