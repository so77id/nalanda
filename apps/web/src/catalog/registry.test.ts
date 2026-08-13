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
    const catalog = buildCatalog([entry('Slide', 'structure'), entry('Video', 'media')]);

    expect(catalog.byName('Slide')?.family).toBe('structure');
    expect(catalog.byName('missing')).toBeUndefined();
    expect(catalog.byFamily('structure').map((e) => e.name)).toEqual(['Slide']);
    expect(catalog.byFamily('interactive')).toEqual([]);
  });

  it('snapshots its input: later mutation of the source array changes nothing', () => {
    const source = [entry('Slide', 'structure')];
    const built = buildCatalog(source);

    source.push(entry('Latecomer', 'media'));

    expect(built.entries).toHaveLength(1);
    expect(built.byName('Latecomer')).toBeUndefined();
    expect(built.byFamily('media')).toEqual([]);
  });

  it('throws on duplicate entry names', () => {
    expect(() => buildCatalog([entry('Slide', 'structure'), entry('Slide', 'media')])).toThrowError(
      /duplicate catalog entry "Slide"/,
    );
  });
});
