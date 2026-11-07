import { describe, expect, it } from 'vitest';

import { excerptOf, fileNameOf, toExcerptLines } from './codeExcerpt';

const FILE = 'a\nb\nc\nd\ne\n';

describe('excerptOf', () => {
  it('shows the whole file, numbered from 1, when no range is given', () => {
    expect(excerptOf(FILE)).toEqual({
      text: 'a\nb\nc\nd\ne',
      first: 1,
      last: 5,
      total: 5,
      above: 0,
      below: 0,
    });
  });

  it('cuts the named lines and counts what stays hidden above and below', () => {
    expect(excerptOf(FILE, '2-4')).toEqual({
      text: 'b\nc\nd',
      first: 2,
      last: 4,
      total: 5,
      above: 1,
      below: 1,
    });
  });

  it('reads a single line, a reversed range, and clamps one that runs past the file', () => {
    expect(excerptOf(FILE, '3').text).toBe('c');
    expect(excerptOf(FILE, '4-2').text).toBe('b\nc\nd');
    expect(excerptOf(FILE, '4-90')).toMatchObject({ first: 4, last: 5, below: 0 });
  });

  it('drops the indentation the quoted lines share, keeping the rest', () => {
    const text = excerptOf('class A {\n    void f() {\n        g();\n    }\n}\n', '2-4').text;
    expect(text).toBe('void f() {\n    g();\n}');
  });

  it('falls back on the whole file for a malformed range', () => {
    expect(excerptOf(FILE, 'doce').first).toBe(1);
  });
});

describe('toExcerptLines', () => {
  it('turns file lines into the listing’s own, dropping the ones it does not show', () => {
    expect(toExcerptLines([1, 2, 4, 5], excerptOf(FILE, '2-4'))).toEqual([1, 3]);
  });
});

describe('fileNameOf', () => {
  it('keeps the base name of a path', () => {
    expect(fileNameOf('asset:courses/x.code/Graph.java')).toBe('Graph.java');
  });
});
