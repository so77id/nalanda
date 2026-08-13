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

// Registration is pinned in `mdxWiring.test.ts`, which resolves vite.config.ts
// and runs the MDX plugin on real markdown.
//
// It used to be pinned here, by reading the config as text and searching for
// plugin names. That was replaced because it did not work: changing the build to
// `remarkPlugins.filter(...)` — dropping GFM from what is actually compiled —
// left this file 7/7 green, while the shipped document chunk fell 3.3 kB and its
// tables turned back into paragraphs of pipes. Reading a config can prove a name
// appears in it; only resolving it proves the value is used.
