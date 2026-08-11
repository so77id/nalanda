import { describe, expect, it } from 'vitest';

import { LAUNCHER_CLASS, LAUNCHER_SOURCE, deriveEntryClass, sourceFileName } from './launcher';

describe('deriveEntryClass', () => {
  it('picks the public class', () => {
    expect(deriveEntryClass('class Helper {}\npublic class Main { }')).toBe('Main');
  });

  it('falls back to the first class when none is public', () => {
    expect(deriveEntryClass('class Solution {\n}\n')).toBe('Solution');
  });

  it('qualifies the name with the package', () => {
    expect(deriveEntryClass('package cl.uchile.eda;\n\npublic class Lista {}')).toBe(
      'cl.uchile.eda.Lista',
    );
  });

  it('ignores the word class inside comments and strings', () => {
    const source = '// a class in a comment\npublic class Real {\n  String s = "class Fake";\n}';
    expect(deriveEntryClass(source)).toBe('Real');
  });

  it('handles modifiers between public and class', () => {
    expect(deriveEntryClass('public final class Nodo<T> {}')).toBe('Nodo');
  });

  it('fails loudly when there is no class at all', () => {
    expect(() => deriveEntryClass('int x = 1;')).toThrow(/no class/i);
  });
});

describe('sourceFileName', () => {
  // ECJ requires the file name to match the public type it declares.
  it('names the file after the simple class name', () => {
    expect(sourceFileName('Main')).toBe('Main.java');
    expect(sourceFileName('cl.uchile.eda.Lista')).toBe('Lista.java');
  });
});

describe('LAUNCHER_SOURCE', () => {
  it('declares the launcher class it is named after', () => {
    expect(LAUNCHER_SOURCE).toContain(`class ${LAUNCHER_CLASS}`);
  });

  it('redirects stdin from a file, because CheerpJ gives a console app neither input nor EOF', () => {
    expect(LAUNCHER_SOURCE).toContain('System.setIn');
  });

  it('takes the entry class as an argument so it can be compiled once and reused', () => {
    expect(LAUNCHER_SOURCE).toContain('Class.forName(args[0])');
  });

  it('trims the reflection plumbing out of student stack traces', () => {
    // Without this a NullPointerException in the student's code is reported
    // with four frames of our launcher underneath it.
    expect(LAUNCHER_SOURCE).toContain('setStackTrace(studentFrames(');
    expect(LAUNCHER_SOURCE).toContain('sun.reflect');
    expect(LAUNCHER_SOURCE).toContain(`name.equals("${LAUNCHER_CLASS}")`);
  });
});
