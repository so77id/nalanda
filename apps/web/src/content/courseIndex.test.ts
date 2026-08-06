import { describe, expect, it } from 'vitest';

import { courseIndex, parseCourseIndex, prevNext, walkIndex } from './courseIndex';
import { registry } from './registry';

const SOURCE = 'index.yaml';

describe('parseCourseIndex', () => {
  it('parses a nested index with labels, level names, and doc ids', () => {
    const index = parseCourseIndex(
      [
        'entries:',
        '  - label: Introducción',
        '    levelName: Unidad',
        '    children:',
        '      - docId: doc-a',
        '      - docId: doc-b',
        '  - docId: doc-c',
      ].join('\n'),
      SOURCE,
    );

    expect(index.entries).toHaveLength(2);
    expect(index.entries[0]).toMatchObject({ label: 'Introducción', levelName: 'Unidad' });
    expect(index.entries[0]?.children?.[0]).toEqual({ docId: 'doc-a' });
    expect(index.entries[1]).toEqual({ docId: 'doc-c' });
  });

  it('rejects a root without an entries list', () => {
    expect(() => parseCourseIndex('levelName: Unidad', SOURCE)).toThrowError(/entries/);
  });

  it('rejects unknown keys, naming the field path and the allowed keys', () => {
    const yaml = ['entries:', '  - docid: doc-a'].join('\n');
    expect(() => parseCourseIndex(yaml, SOURCE)).toThrowError(
      /entries\[0\].*unknown key "docid".*docId/s,
    );
  });

  it('rejects an entry with neither docId nor children', () => {
    const yaml = ['entries:', '  - label: Vacío'].join('\n');
    expect(() => parseCourseIndex(yaml, SOURCE)).toThrowError(/entries\[0\].*docId.*children/s);
  });

  it('rejects a group entry without a label', () => {
    const yaml = ['entries:', '  - children:', '      - docId: doc-a'].join('\n');
    expect(() => parseCourseIndex(yaml, SOURCE)).toThrowError(/entries\[0\].*label/s);
  });

  it('rejects wrongly typed fields with the field path', () => {
    const yaml = ['entries:', '  - docId: 42'].join('\n');
    expect(() => parseCourseIndex(yaml, SOURCE)).toThrowError(/entries\[0\]\.docId.*string/s);
  });
});

describe('walkIndex / prevNext', () => {
  const index = parseCourseIndex(
    [
      'entries:',
      '  - label: A',
      '    children:',
      '      - docId: one',
      '      - label: A2',
      '        children:',
      '          - docId: two',
      '  - docId: three',
    ].join('\n'),
    SOURCE,
  );

  it('walks entries depth-first into a linear doc order', () => {
    expect(walkIndex(index)).toEqual(['one', 'two', 'three']);
  });

  it('computes prev/next along the walk, with edges empty', () => {
    expect(prevNext(index, 'one')).toEqual({ prev: undefined, next: 'two' });
    expect(prevNext(index, 'two')).toEqual({ prev: 'one', next: 'three' });
    expect(prevNext(index, 'three')).toEqual({ prev: 'two', next: undefined });
    expect(prevNext(index, 'unlisted')).toEqual({ prev: undefined, next: undefined });
  });
});

describe('courseIndex (real content/ tree)', () => {
  it('exists and every referenced docId resolves in the registry', () => {
    const ids = walkIndex(courseIndex);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(registry.get(id), `index references unknown doc "${id}"`).toBeDefined();
    }
  });
});
