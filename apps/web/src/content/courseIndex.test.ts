import { describe, expect, it } from 'vitest';

import { parseCourseIndex, prevNext, trailFor, walkIndex } from './courseIndex';

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

  it('reads the optional course title from the root', () => {
    const yaml = ['title: Estructuras de Datos', 'entries:', '  - docId: doc-a'].join('\n');
    expect(parseCourseIndex(yaml, SOURCE).title).toBe('Estructuras de Datos');
  });

  it('leaves the course title undefined when the root omits it', () => {
    const index = parseCourseIndex(['entries:', '  - docId: doc-a'].join('\n'), SOURCE);
    expect(index.title).toBeUndefined();
  });

  it('rejects a non-string course title, naming the source and the field', () => {
    const yaml = ['title: 42', 'entries:', '  - docId: doc-a'].join('\n');
    expect(() => parseCourseIndex(yaml, SOURCE)).toThrowError(
      /index\.yaml.*root\.title.*non-empty string/s,
    );
  });

  it('rejects an empty course title rather than rendering an empty crumb', () => {
    const yaml = ['title: ""', 'entries:', '  - docId: doc-a'].join('\n');
    expect(() => parseCourseIndex(yaml, SOURCE)).toThrowError(/root\.title/s);
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

  it('rejects a docId listed twice, naming the second occurrence', () => {
    const yaml = [
      'entries:',
      '  - docId: doc-a',
      '  - label: Grupo',
      '    children:',
      '      - docId: doc-a',
    ].join('\n');
    expect(() => parseCourseIndex(yaml, SOURCE)).toThrowError(
      /entries\[1\]\.children\[0\].*duplicate docId "doc-a"/s,
    );
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

describe('trailFor', () => {
  const index = parseCourseIndex(
    [
      'title: Estructuras de Datos',
      'entries:',
      '  - docId: bienvenida',
      '  - label: Java para quien viene de C++',
      '    levelName: Unidad',
      '    children:',
      '      - docId: java-desde-cpp',
      '      - docId: java-avanzado',
      '      - label: Anexos',
      '        levelName: Sección',
      '        children:',
      '          - docId: tabla-de-equivalencias',
    ].join('\n'),
    SOURCE,
  );

  it('names the course as the first crumb', () => {
    expect(trailFor(index, 'java-desde-cpp').course).toBe('Estructuras de Datos');
  });

  it('omits the course crumb when the index has no title', () => {
    const untitled = parseCourseIndex(['entries:', '  - docId: solo'].join('\n'), SOURCE);
    expect(trailFor(untitled, 'solo').course).toBeUndefined();
  });

  it('lists the ancestor groups from the root down, with their level names', () => {
    expect(trailFor(index, 'tabla-de-equivalencias').ancestors).toEqual([
      { label: 'Java para quien viene de C++', levelName: 'Unidad' },
      { label: 'Anexos', levelName: 'Sección' },
    ]);
  });

  it('positions a document among its siblings, groups included', () => {
    // The group "Anexos" is the third child of the unit, so java-avanzado is 2 of 3.
    expect(trailFor(index, 'java-avanzado').position).toEqual({ at: 2, of: 3 });
  });

  it('counts a top-level document against the top-level entries', () => {
    expect(trailFor(index, 'bienvenida').position).toEqual({ at: 1, of: 2 });
  });

  it('has no ancestors and no position for a document the index does not list', () => {
    const trail = trailFor(index, 'apuntes-sueltos');
    expect(trail.ancestors).toEqual([]);
    expect(trail.position).toBeUndefined();
  });

  it('still names the course for a document the index does not list', () => {
    // /d/<id> serves unlisted documents: the index controls navigation, never
    // visibility — so the breadcrumb degrades to the course name alone.
    expect(trailFor(index, 'apuntes-sueltos').course).toBe('Estructuras de Datos');
  });

  it('does not treat a group that also carries a docId as its own ancestor', () => {
    const withGroupDoc = parseCourseIndex(
      [
        'entries:',
        '  - label: Unidad con portada',
        '    docId: portada',
        '    children:',
        '      - docId: hijo',
      ].join('\n'),
      SOURCE,
    );
    expect(trailFor(withGroupDoc, 'portada').ancestors).toEqual([]);
    expect(trailFor(withGroupDoc, 'hijo').ancestors).toEqual([
      { label: 'Unidad con portada', levelName: undefined },
    ]);
  });
});
