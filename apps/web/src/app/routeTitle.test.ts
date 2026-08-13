import { describe, expect, it } from 'vitest';

import { BRAND, routeTitle } from './routeTitle';

const TITLES: Record<string, string> = {
  'java-desde-cpp': 'Java desde C++',
  bienvenida: 'Bienvenida',
};
const lookup = (id: string): string | undefined => TITLES[id];
// A family id is a route slug; its display name is what belongs in a tab.
const familyName = (id: string): string | undefined => ({ interactivos: 'Interactivos' })[id];

describe('routeTitle', () => {
  it('names the document being read', () => {
    expect(routeTitle('/d/java-desde-cpp', lookup, familyName)).toBe('Java desde C++ · Nalanda');
  });

  it('gives a presented document the same name as the read one', () => {
    // Someone hunting through tabs is looking for the document, not the mode.
    expect(routeTitle('/d/java-desde-cpp/present', lookup, familyName)).toBe(
      'Java desde C++ · Nalanda',
    );
  });

  it('falls back to the brand for a document the registry does not know', () => {
    // `/d/<id>` serves documents the index never lists; an unknown id is a 404
    // in the page, and a title claiming otherwise would be worse than none.
    expect(routeTitle('/d/no-existe', lookup, familyName)).toBe(BRAND);
  });

  it('names the catalog and its pages, most specific first', () => {
    expect(routeTitle('/catalog', lookup, familyName)).toBe('Catalog · Nalanda');
    expect(routeTitle('/catalog/governance', lookup, familyName)).toBe(
      'Governance · Catalog · Nalanda',
    );
    expect(routeTitle('/catalog/interactivos', lookup, familyName)).toBe(
      'Interactivos · Catalog · Nalanda',
    );
    // An unknown family still gets a title rather than a crash.
    expect(routeTitle('/catalog/inventada', lookup, familyName)).toBe(
      'inventada · Catalog · Nalanda',
    );
    expect(routeTitle('/catalog/c/Exercise', lookup, familyName)).toBe(
      'Exercise · Catalog · Nalanda',
    );
  });

  it('uses the bare brand for the home page', () => {
    expect(routeTitle('/', lookup, familyName)).toBe(BRAND);
  });

  it('survives trailing slashes and an unknown route', () => {
    expect(routeTitle('/d/bienvenida/', lookup, familyName)).toBe('Bienvenida · Nalanda');
    expect(routeTitle('/quien-sabe', lookup, familyName)).toBe(BRAND);
    expect(routeTitle('', lookup, familyName)).toBe(BRAND);
  });

  it('survives a malformed percent-escape instead of throwing', () => {
    // `/d/%` threw URIError inside an effect, and with no error boundary React
    // unmounted the root: a URL anyone can type blanked the whole site where the
    // router alone renders the 404 page.
    expect(() => routeTitle('/d/%', lookup, familyName)).not.toThrow();
    expect(routeTitle('/d/%', lookup, familyName)).toBe(BRAND);
    expect(routeTitle('/catalog/%E0%A4%A', lookup, familyName)).toBe(
      '%E0%A4%A · Catalog · Nalanda',
    );
  });

  it('decodes an id before looking it up, on every route that carries one', () => {
    const seen: string[] = [];
    const spy = (id: string): string | undefined => {
      seen.push(id);
      return TITLES[id];
    };
    routeTitle('/d/java-desde-cpp', spy, familyName);
    expect(seen).toContain('java-desde-cpp');

    // The family branch decodes too, and had no test of its own.
    expect(routeTitle('/catalog/inter%20activos', lookup, familyName)).toBe(
      'inter activos · Catalog · Nalanda',
    );
  });

  it('handles /catalog/c with no component name', () => {
    expect(routeTitle('/catalog/c', lookup, familyName)).toBe('Catalog · Nalanda');
  });

  it('decodes a percent-encoded id', () => {
    expect(routeTitle('/catalog/c/Side%20By%20Side', lookup, familyName)).toBe(
      'Side By Side · Catalog · Nalanda',
    );
  });

  it('gives every route a distinct title (the whole point)', () => {
    const paths = ['/', '/d/bienvenida', '/d/java-desde-cpp', '/catalog', '/catalog/governance'];
    const titles = paths.map((p) => routeTitle(p, lookup, familyName));
    expect(new Set(titles).size).toBe(paths.length);
  });
});
