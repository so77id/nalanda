import type { Link, Paragraph, Root, RootContent } from 'mdast';
import { describe, expect, it } from 'vitest';

import { remarkWikiLinks } from './wikiLinks';

function doc(value: string): Root {
  return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] };
}

function inlineChildren(tree: Root): RootContent[] {
  return (tree.children[0] as Paragraph).children;
}

function transform(tree: Root): Root {
  remarkWikiLinks()(tree);
  return tree;
}

describe('remarkWikiLinks', () => {
  it('turns [[id]] into a wiki: link labeled with the id', () => {
    const tree = transform(doc('See [[doc-a]] here'));
    const children = inlineChildren(tree);

    expect(children).toHaveLength(3);
    expect(children[0]).toMatchObject({ type: 'text', value: 'See ' });
    expect(children[1]).toMatchObject({
      type: 'link',
      url: 'wiki:doc-a',
      children: [{ type: 'text', value: 'doc-a' }],
    });
    expect(children[2]).toMatchObject({ type: 'text', value: ' here' });
  });

  it('turns [[id|custom text]] into a wiki: link with the custom label', () => {
    const tree = transform(doc('Go to [[doc-a|la bienvenida]].'));
    const link = inlineChildren(tree)[1] as Link;

    expect(link.url).toBe('wiki:doc-a');
    expect(link.children).toEqual([{ type: 'text', value: 'la bienvenida' }]);
  });

  it('transforms every wiki link in the same text node', () => {
    const tree = transform(doc('[[doc-a]] y [[doc-b|otro]]'));
    const children = inlineChildren(tree);

    expect(children.filter((c) => c.type === 'link')).toHaveLength(2);
    expect(children.map((c) => c.type)).toEqual(['link', 'text', 'link']);
  });

  it('leaves text without wiki links untouched', () => {
    const tree = transform(doc('Plain [not a link] text'));
    expect(inlineChildren(tree)).toEqual([{ type: 'text', value: 'Plain [not a link] text' }]);
  });

  it('does not touch inline code', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'inlineCode', value: 'array[[0]]' }] }],
    };
    expect(inlineChildren(transform(tree))).toEqual([{ type: 'inlineCode', value: 'array[[0]]' }]);
  });
});
