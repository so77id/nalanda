import { describe, expect, it } from 'vitest';

import {
  HARNESS_CLASS,
  LAUNCHER_CLASS,
  LAUNCHER_SOURCE,
  RESERVED_CLASSES,
  TRUNCATED,
  deriveEntryClass,
  reservedDeclarations,
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

  it('reserves every class name the platform compiles', () => {
    // Two units ship platform code today (this launcher and the exercise
    // harness), so two names are reserved. A third was reserved through #116
    // and retired in #209 with the widget that owned it.
    expect(RESERVED_CLASSES).toContain(LAUNCHER_CLASS);
    expect(RESERVED_CLASSES).toContain(HARNESS_CLASS);
    expect(RESERVED_CLASSES).toHaveLength(2);
  });
});

describe('reservedDeclarations', () => {
  it('finds a reserved class declared beside the public one', () => {
    // The hazard the entry-class check could not see: `deriveEntryClass` returns
    // the PUBLIC class, so the launcher-shaped second declaration compiled
    // anyway and overwrote the memoised launcher for the whole page.
    const source = ['public class Solucion { }', `class ${LAUNCHER_CLASS} { }`].join('\n');

    expect(reservedDeclarations(source)).toEqual([LAUNCHER_CLASS]);
  });

  it.each([HARNESS_CLASS, LAUNCHER_CLASS])('finds %s', (reserved) => {
    expect(reservedDeclarations(`public class Solucion {}\nclass ${reserved} {}`)).toEqual([
      reserved,
    ]);
  });

  it.each(['class', 'interface', 'enum'])('finds the %s form', (keyword) => {
    // All three declare the same binary name, so all three overwrite the same
    // .class in the shared output directory.
    expect(
      reservedDeclarations(`public class Solucion {}\n${keyword} ${LAUNCHER_CLASS} {}`),
    ).toEqual([LAUNCHER_CLASS]);
  });

  it('finds the entry class itself', () => {
    expect(reservedDeclarations(`public class ${LAUNCHER_CLASS} { }`)).toEqual([LAUNCHER_CLASS]);
  });

  it('ignores a reserved name that is only mentioned', () => {
    // Prose and text are not declarations: a program explaining the rule, or
    // printing the name, still compiles.
    //
    // The keyword is written in English INSIDE the Spanish comment on purpose,
    // and the string literal sits at the top level as an annotation argument —
    // the only place valid Java puts one there. An earlier version of this test
    // said «no llames a tu clase» and put the string inside the class body, and
    // so passed with `stripNonCode` removed altogether: the Spanish *clase*
    // never matched the scan, and the string was suppressed by brace depth
    // rather than by the stripper it claimed to be testing.
    const source = [
      `// nunca escribas class ${LAUNCHER_CLASS} en tu programa`,
      `@SuppressWarnings("class ${HARNESS_CLASS} {")`,
      'public class Solucion {',
      `  String s = "class ${LAUNCHER_CLASS} {";`,
      '}',
    ].join('\n');

    expect(reservedDeclarations(source)).toEqual([]);
  });

  it('ignores a nested reserved declaration, which collides with nothing', () => {
    // A member class compiles to `Solucion$NalandaLauncher.class`, so it cannot
    // overwrite the platform's. Refusing it would be a false positive.
    const source = `public class Solucion {\n  static class ${LAUNCHER_CLASS} { }\n}`;

    expect(reservedDeclarations(source)).toEqual([]);
  });

  it('says nothing about an ordinary program', () => {
    expect(reservedDeclarations('public class Main { void f() { int[] a = {1, 2}; } }')).toEqual(
      [],
    );
  });

  it('does not match a longer name that merely starts with a reserved one', () => {
    expect(reservedDeclarations(`public class ${LAUNCHER_CLASS}Mio { }`)).toEqual([]);
  });

  // Java translates `\uXXXX` before it lexes anything (JLS §3.3), so a scan of
  // the raw text is reading a different program than the compiler. Each shape
  // below was compiled by the pinned ECJ 3.21.0 and then run in real CheerpJ: all
  // three emitted a top-level NalandaLauncher.class into the shared output
  // directory and `java -cp shared NalandaLauncher Solucion` printed the
  // hijacker's line instead of the student's program.
  describe('unicode escapes', () => {
    it('sees a brace that was written as an escape', () => {
      // { is `{`. Hiding the opening brace used to send the depth count
      // negative, and the old `depth === 0` test then skipped everything after.
      const source = [
        'public class Solucion \\u007b',
        '  public static void main(String[] a) { }',
        '}',
        `class ${LAUNCHER_CLASS} { public static void main(String[] a) { } }`,
      ].join('\n');

      expect(reservedDeclarations(source)).toEqual([LAUNCHER_CLASS]);
    });

    it('sees a declaration hidden behind an escaped newline in a comment', () => {
      // The escape IS the newline that ends the comment, so what looks
      // commented out is what gets compiled.
      const source = [
        'public class Solucion { public static void main(String[] a) { } }',
        `// \\u000a class ${LAUNCHER_CLASS} { public static void main(String[] a) { } }`,
      ].join('\n');

      expect(reservedDeclarations(source)).toEqual([LAUNCHER_CLASS]);
    });

    it('sees a declaration hidden behind an escaped CARRIAGE RETURN', () => {
      // JLS §3.4 makes a lone CR a line terminator too, and §3.7 excludes it
      // from `InputCharacter`. Stopping the comment at LF alone left this shape
      // alive after the LF one was closed — the same hijack, two characters
      // apart.
      const source = [
        'public class Solucion { public static void main(String[] a) { } }',
        `// \\u000d class ${LAUNCHER_CLASS} { public static void main(String[] a) { } }`,
      ].join('\n');

      expect(reservedDeclarations(source)).toEqual([LAUNCHER_CLASS]);
    });

    it('sees one behind a RAW carriage return, which needs no escape at all', () => {
      // A file with classic-Mac line endings is enough; nothing here is exotic.
      const source = `public class Solucion { }\n// \r class ${LAUNCHER_CLASS} { }`;

      expect(reservedDeclarations(source)).toEqual([LAUNCHER_CLASS]);
    });

    it('sees an escaped keyword', () => {
      // c is `c`, so this reads `class` to the compiler and nothing to us.
      expect(reservedDeclarations(`\\u0063lass ${LAUNCHER_CLASS} {}`)).toEqual([LAUNCHER_CLASS]);
    });

    it('sees it through a run of u, which Java allows', () => {
      expect(reservedDeclarations(`\\uuuu0063lass ${LAUNCHER_CLASS} {}`)).toEqual([LAUNCHER_CLASS]);
    });

    it('leaves an escaped backslash alone, because the compiler does', () => {
      // `"\\u0063"` is a backslash and a `u`, printed as such — decoding it would
      // corrupt the string the program was printing. Only a backslash preceded
      // by an EVEN number of backslashes is eligible (JLS §3.3).
      const source = [
        'public class Solucion {',
        '  public static void main(String[] a) { System.out.println("\\\\u0063lass Nalanda"); }',
        '}',
      ].join('\n');

      expect(reservedDeclarations(source)).toEqual([]);
    });
  });

  it('reports every reserved name it finds, in order', () => {
    const source = [
      'public class Solucion {}',
      `class ${LAUNCHER_CLASS} {}`,
      `interface ${HARNESS_CLASS} {}`,
    ].join('\n');

    expect(reservedDeclarations(source)).toEqual([LAUNCHER_CLASS, HARNESS_CLASS]);
  });
});
