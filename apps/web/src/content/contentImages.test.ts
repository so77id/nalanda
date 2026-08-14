import type { Image, Paragraph, Root, RootContent } from 'mdast';
import { describe, expect, it } from 'vitest';

import { remarkContentImages } from './contentImages';

/** The JSX node shape, spelled out here so the test names no extra package. */
interface JsxElement {
  type: 'mdxJsxFlowElement';
  name: string;
  attributes: { type: string; name: string; value: unknown }[];
  children: [];
}

// Hermetic stand-ins for the real tree: the plugin's whole job is turning a path
// relative to THIS document into one relative to the content root.
const CONTENT_ROOT = new URL('file:///repo/content/');
const DOCUMENT = { path: '/repo/content/courses/eda/01-bienvenida.mdx' };

function withImage(url: string): Root {
  return {
    type: 'root',
    children: [
      { type: 'paragraph', children: [{ type: 'image', url, alt: 'un diagrama' }] } as Paragraph,
    ],
  };
}

function withJsx(attributeValue: string): Root {
  const element: JsxElement = {
    type: 'mdxJsxFlowElement',
    name: 'Figure',
    attributes: [{ type: 'mdxJsxAttribute', name: 'src', value: attributeValue }],
    children: [],
  };
  return { type: 'root', children: [element as unknown as RootContent] };
}

function transform(tree: Root, file: { path?: string } = DOCUMENT): Root {
  remarkContentImages({ contentRoot: CONTENT_ROOT })(tree, file);
  return tree;
}

function imageUrl(tree: Root): string {
  return ((tree.children[0] as Paragraph).children[0] as Image).url;
}

function jsxSrc(tree: Root): unknown {
  const element = tree.children[0] as unknown as JsxElement;
  return element.attributes[0].value;
}

describe('remarkContentImages', () => {
  it('rewrites a relative markdown image into a content-root asset key', () => {
    // The failure this exists for: MDX leaves the authored path as a literal
    // string, Vite never sees it, and under /nalanda/ the browser resolves it
    // against the document route and 404s. Measured on main: the build emitted
    // no asset and `./spike.svg` survived verbatim into the document chunk.
    const tree = transform(withImage('./curva.svg'));

    expect(imageUrl(tree)).toBe('asset:courses/eda/curva.svg');
  });

  it('resolves a path that climbs out of the document folder', () => {
    const tree = transform(withImage('../compartidas/heap.svg'));

    expect(imageUrl(tree)).toBe('asset:courses/compartidas/heap.svg');
  });

  it('rewrites the src of a JSX element, not only markdown syntax', () => {
    // <Figure src="./x.svg" /> is the form every slide uses; it is the same
    // literal-string hazard one syntax over.
    const tree = transform(withJsx('./logos/google.svg'));

    expect(jsxSrc(tree)).toBe('asset:courses/eda/logos/google.svg');
  });

  it.each([
    ['https://example.com/x.svg'],
    ['//example.com/x.svg'],
    ['/nalanda/favicon.svg'],
    ['data:image/svg+xml,%3csvg%3e%3c/svg%3e'],
  ])('leaves %s alone', (url) => {
    expect(imageUrl(transform(withImage(url)))).toBe(url);
  });

  it('leaves an image alone when the document has no path', () => {
    // `evaluate()` in a test compiles a bare string: there is no document to be
    // relative to, and guessing one would invent a key that resolves nowhere.
    const tree = transform(withImage('./curva.svg'), {});

    expect(imageUrl(tree)).toBe('./curva.svg');
  });
});
