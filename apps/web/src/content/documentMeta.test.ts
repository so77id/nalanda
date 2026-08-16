import { describe, expect, it } from 'vitest';

import { parseDocumentMeta, parseFrontmatterBlock } from './documentMeta';

describe('parseFrontmatterBlock', () => {
  it('parses the YAML block delimited by --- fences', () => {
    const raw = '---\nid: doc-a\ntitle: Doc A\n---\n\n# Body\n';
    expect(parseFrontmatterBlock(raw)).toEqual({ id: 'doc-a', title: 'Doc A' });
  });

  it('returns null when the source has no frontmatter', () => {
    expect(parseFrontmatterBlock('# Just a body\n')).toBeNull();
  });

  it('does not treat a --- ruler later in the body as frontmatter', () => {
    expect(parseFrontmatterBlock('# Body\n\n---\nid: nope\n---\n')).toBeNull();
  });
});

describe('parseDocumentMeta — presentation config', () => {
  const base = { id: 'doc-a', title: 'Doc A' };

  it('defaults to auto when absent (every document is presentable for now)', () => {
    expect(parseDocumentMeta('a.mdx', base).presentation).toBe('auto');
  });

  it('accepts explicit and none', () => {
    expect(parseDocumentMeta('a.mdx', { ...base, presentation: 'explicit' }).presentation).toBe(
      'explicit',
    );
    expect(parseDocumentMeta('a.mdx', { ...base, presentation: 'none' }).presentation).toBe('none');
  });

  it('rejects unknown values naming the field and file', () => {
    expect(() => parseDocumentMeta('a.mdx', { ...base, presentation: 'slides' })).toThrowError(
      /presentation.*auto.*explicit.*none.*a\.mdx/s,
    );
  });
});

describe('parseDocumentMeta — questions coverage (issue #139)', () => {
  const base = { id: 'doc-a', title: 'Doc A' };

  // Same shape as `presentation` above: optional in the schema so a document
  // mid-edit still parses, and required in practice by the suite — a document
  // that never declares it is one whose author never decided (#108).
  it('defaults to none when absent', () => {
    expect(parseDocumentMeta('a.mdx', base).questions).toBe('none');
  });

  it('accepts per-section and pool', () => {
    expect(parseDocumentMeta('a.mdx', { ...base, questions: 'per-section' }).questions).toBe(
      'per-section',
    );
    expect(parseDocumentMeta('a.mdx', { ...base, questions: 'pool' }).questions).toBe('pool');
  });

  it('rejects unknown values naming the field and file', () => {
    expect(() => parseDocumentMeta('a.mdx', { ...base, questions: 'todas' })).toThrowError(
      /questions.*per-section.*pool.*none.*a\.mdx/s,
    );
  });
});
