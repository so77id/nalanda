import { describe, expect, it } from 'vitest';

import { buildRegistry } from './registry';

const fakeLoader = () => Promise.resolve({ default: () => null });

function loadersFor(metas: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(metas).map((path) => [path, fakeLoader]));
}

describe('buildRegistry', () => {
  it('indexes documents by frontmatter id with title and loader', () => {
    const metas = {
      '/content/courses/c/a.mdx': { id: 'doc-a', title: 'Doc A' },
      '/content/courses/c/b.mdx': { id: 'doc-b', title: 'Doc B' },
    };
    const reg = buildRegistry(metas, loadersFor(metas));

    expect(reg.entries).toHaveLength(2);
    const a = reg.get('doc-a');
    expect(a?.meta.title).toBe('Doc A');
    expect(a?.sourcePath).toBe('/content/courses/c/a.mdx');
    expect(typeof a?.load).toBe('function');
    expect(reg.get('missing')).toBeUndefined();
  });

  it('throws on duplicate ids, naming the id and both files', () => {
    const metas = {
      '/content/courses/c/a.mdx': { id: 'doc-a', title: 'First' },
      '/content/courses/c/copy.mdx': { id: 'doc-a', title: 'Second' },
    };
    expect(() => buildRegistry(metas, loadersFor(metas))).toThrowError(
      /duplicate document id "doc-a".*a\.mdx.*copy\.mdx/s,
    );
  });

  it('throws when frontmatter is missing an id', () => {
    const metas = { '/content/courses/c/a.mdx': { title: 'No id' } };
    expect(() => buildRegistry(metas, loadersFor(metas))).toThrowError(/missing.*"id".*a\.mdx/s);
  });

  it('throws when the id is not kebab-case', () => {
    const metas = { '/content/courses/c/a.mdx': { id: 'Not Kebab', title: 'Bad' } };
    expect(() => buildRegistry(metas, loadersFor(metas))).toThrowError(/kebab-case.*a\.mdx/s);
  });

  it('throws when frontmatter is missing a title', () => {
    const metas = { '/content/courses/c/a.mdx': { id: 'doc-a' } };
    expect(() => buildRegistry(metas, loadersFor(metas))).toThrowError(/missing.*"title".*a\.mdx/s);
  });
});
