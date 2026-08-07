import { describe, expect, it } from 'vitest';

import type { CatalogEntry } from '../lib/catalogEntry';

import { buildCatalog } from './registry';

function entry(name: string, family: CatalogEntry['family']): CatalogEntry {
  return {
    name,
    family,
    description: `${name} description`,
    whenToUse: 'whenever',
    props: [],
    examples: [],
  };
}

describe('buildCatalog', () => {
  it('indexes entries by name and groups them by family', () => {
    const catalog = buildCatalog([entry('Slide', 'estructura'), entry('Video', 'media')]);

    expect(catalog.byName('Slide')?.family).toBe('estructura');
    expect(catalog.byName('missing')).toBeUndefined();
    expect(catalog.byFamily('estructura').map((e) => e.name)).toEqual(['Slide']);
    expect(catalog.byFamily('interactivos')).toEqual([]);
  });

  it('throws on duplicate entry names', () => {
    expect(() =>
      buildCatalog([entry('Slide', 'estructura'), entry('Slide', 'media')]),
    ).toThrowError(/duplicate catalog entry "Slide"/);
  });
});
