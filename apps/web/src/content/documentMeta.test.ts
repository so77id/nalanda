import { describe, expect, it } from 'vitest';

import { parseFrontmatterBlock } from './documentMeta';

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
