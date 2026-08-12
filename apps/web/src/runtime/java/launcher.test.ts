import { describe, expect, it } from 'vitest';

import {
  HARNESS_CLASS,
  LAUNCHER_CLASS,
  LAUNCHER_SOURCE,
  RESERVED_CLASSES,
  TRUNCATED,
  deriveEntryClass,
  sourceFileName,
} from './launcher';

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

  it('prefers the top-level public class over a nested public static one', () => {
    // A nested class cannot be an entry point, and `static` is only legal on
    // nested declarations — so it must never win.
    const source = 'class Lista {\n  public static class Nodo {}\n}\npublic class Main {}';
    expect(deriveEntryClass(source)).toBe('Main');
  });

  it('is not thrown off by a // inside a string literal', () => {
    // One line on purpose: with the declarations on separate lines a broken
    // stripper still gets the right answer by accident, which is how the first
    // version of this test passed while the bug was live.
    const source = 'class Config { String url = "http://example.com"; } public class Main {}';
    expect(deriveEntryClass(source)).toBe('Main');
  });

  it('is not thrown off by a class declaration quoted inside a string', () => {
    const source = 'public class Main { String s = "class Decoy {"; }';
    expect(deriveEntryClass(source)).toBe('Main');
  });

  it('is not thrown off by an apostrophe inside a comment', () => {
    // Masking char literals before comments would swallow the rest of the file.
    const source = "// don't be fooled\npublic class Main {}";
    expect(deriveEntryClass(source)).toBe('Main');
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

describe('output cap', () => {
  it('wraps System.out so a program cannot flood the page', () => {
    // Not a taste question: measured in Chromium, 10k printed lines stall the
    // main thread ~1.2s and 20k crash the renderer. That is a program that
    // TERMINATES, which is not the hazard ADR-0020 accepted.
    expect(LAUNCHER_SOURCE).toContain('System.setOut(');
    expect(LAUNCHER_SOURCE).toContain('new Capped(System.out');
  });

  it('says so once instead of truncating silently', () => {
    expect(LAUNCHER_SOURCE).toContain(TRUNCATED);
  });

  it('reserves the two class names the platform compiles', () => {
    expect(RESERVED_CLASSES).toContain(LAUNCHER_CLASS);
    expect(RESERVED_CLASSES).toContain(HARNESS_CLASS);
  });
});
