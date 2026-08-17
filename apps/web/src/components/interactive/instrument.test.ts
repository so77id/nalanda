import { describe, expect, it } from 'vitest';

import { instrument, stripMarkers } from './trace';

describe('instrument', () => {
  it('replaces a marker with the calls that photograph those variables', () => {
    const { code } = instrument(
      ['Punto a = new Punto(1, 2);', 'Punto b = a; // foto a, b'].join('\n'),
    );

    expect(code.split('\n')[1]).toBe(
      'Punto b = a; NalandaTrace.inicio(2, "main"); NalandaTrace.var("a", a); NalandaTrace.var("b", b); NalandaTrace.fin();',
    );
  });

  it('keeps every line where it was', () => {
    // The reader is shown the ORIGINAL source and the highlight uses the line
    // the tracer reports, so injecting a line would offset every number after
    // it and highlight the wrong statement.
    const source = ['int a = 1; // foto a', 'int b = 2;', 'int c = 3; // foto a, b, c'].join('\n');
    const { code, markers } = instrument(source);

    expect(code.split('\n')).toHaveLength(3);
    expect(markers.map((one) => one.line)).toEqual([1, 3]);
  });

  it('defaults to the main frame and takes a named one', () => {
    const { markers } = instrument(
      ['int a = 1; // foto a', 'int p = 2; // foto swap: p'].join('\n'),
    );

    expect(markers[0]).toMatchObject({ frame: 'main', variables: ['a'] });
    expect(markers[1]).toMatchObject({ frame: 'swap', variables: ['p'] });
  });

  it('closes a frame the author opened', () => {
    const { code } = instrument('int p = 2; // foto-fin swap');

    expect(code).toBe('int p = 2; NalandaTrace.finMarco("swap");');
  });

  it('leaves ordinary comments alone', () => {
    const source = 'int a = 1; // esto es un comentario normal';

    expect(instrument(source).code).toBe(source);
  });

  it('reports a marker that names no variables', () => {
    const { errors } = instrument('int a = 1; // foto');

    expect(errors[0]).toMatch(/línea 1/);
    expect(errors[0]).toMatch(/sin variables/i);
  });

  it('reports a name that is not a Java identifier', () => {
    const { errors } = instrument('int a = 1; // foto a, 2b');

    expect(errors[0]).toMatch(/2b/);
  });

  it('reports a snippet with no markers at all, rather than drawing nothing', () => {
    const { errors } = instrument('int a = 1;');

    expect(errors[0]).toMatch(/foto/);
  });

  it('refuses a snippet that declares the tracer itself', () => {
    // A class named NalandaTrace overwrites the one collecting the trace, so the
    // diagram would draw whatever the author's version emitted. The runtime
    // refuses this too (#123); saying so here costs no JVM, and an unrunnable
    // `trace` fence is an authoring mistake, reported as one.
    const { errors } = instrument(
      ['public class Demo { }', 'class NalandaTrace { }', 'int a = 1; // foto a'].join('\n'),
    );

    expect(errors[0]).toMatch(/NalandaTrace/);
    expect(errors[0]).toMatch(/reservado/i);
  });

  it('tolerates spacing around the marker and its commas', () => {
    const { markers } = instrument('int a = 1;    //foto   a ,  b');

    expect(markers[0]).toMatchObject({ frame: 'main', variables: ['a', 'b'] });
  });
});

describe('stripMarkers', () => {
  it('removes the marker but keeps the code and the line count', () => {
    const source = ['int a = 1; // foto a', 'int b = 2;', '// foto-fin swap'].join('\n');

    expect(stripMarkers(source).split('\n')).toEqual(['int a = 1;', 'int b = 2;', '']);
  });

  it('leaves an ordinary comment where the author put it', () => {
    const source = 'int a = 1; // cuenta las vueltas';

    expect(stripMarkers(source)).toBe(source);
  });
});

describe('markers that are not markers', () => {
  // A Spanish-language course is full of words starting with "foto". Without a
  // word boundary these either poisoned the diagram or refused it outright.
  it.each([
    'int a = 1; // fotos: a, b',
    'int a = 1; // fotografía de la memoria',
    'int a = 1; // fotocopia esto',
  ])('leaves %s alone', (line) => {
    const source = [line, 'int b = 2; // foto b'].join('\n');
    const { errors, markers } = instrument(source);

    expect(errors).toEqual([]);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.line).toBe(2);
    expect(stripMarkers(source).split('\n')[0]).toBe(line);
  });

  it('still recognises foto-fin, which the boundary sits inside', () => {
    expect(instrument('x(); // foto-fin swap').code).toBe('x(); NalandaTrace.finMarco("swap");');
  });
});

describe('identifiers containing $', () => {
  it('emits the name the author wrote, not a substitution', () => {
    // `$1`, `$&` and `$$` are substitution patterns in a replacement STRING, and
    // Java identifiers may contain `$`: this used to emit var("aa$1", aa$1).
    const { code } = instrument('int t = a$1 + 1; // foto a$1');

    expect(code).toContain('NalandaTrace.var("a$1", a$1);');
    expect(code).not.toContain('aa$1');
  });

  it('does not collapse a doubled $', () => {
    expect(instrument('f(); // foto a$$b').code).toContain('NalandaTrace.var("a$$b", a$$b);');
  });
});

describe('the reserved name in any shape', () => {
  it.each(['class', 'interface', 'enum'])('refuses %s NalandaTrace', (keyword) => {
    // All three declare the same binary name as the library unit compiled beside
    // the snippet, so all three collide the same way.
    const { errors } = instrument(
      [`${keyword} NalandaTrace {}`, 'int a = 1; // foto a'].join('\n'),
    );

    expect(errors[0]).toMatch(/NalandaTrace/);
    expect(errors[0]).toMatch(/reservado/i);
  });

  // The three properties below come from sharing the runtime's guard rather than
  // restating it here: one statement of the rule, one set of edges (#123).
  it.each(['NalandaLauncher', 'NalandaCheck'])('refuses %s as well', (reserved) => {
    // A `trace` fence is sent as `source`, so every reserved name collides in it,
    // not only the tracer's. The private regex this replaced knew one name.
    const { errors } = instrument([`class ${reserved} {}`, 'int a = 1; // foto a'].join('\n'));

    expect(errors[0]).toMatch(new RegExp(reserved));
    expect(errors[0]).toMatch(/reservado/i);
  });

  it('allows a nested declaration, which collides with nothing', () => {
    // `Demo$NalandaTrace.class` overwrites no platform class, so refusing it
    // would block a legitimate snippet.
    const { errors } = instrument(
      ['public class Demo {', '  static class NalandaTrace { }', '}', 'int a = 1; // foto a'].join(
        '\n',
      ),
    );

    expect(errors).toEqual([]);
  });

  it('allows a snippet that only mentions the name', () => {
    // The private regex read the raw source, so a comment naming the rule
    // refused the diagram that was explaining it.
    const { errors } = instrument(
      ['// no declares class NalandaTrace aquí', 'int a = 1; // foto a'].join('\n'),
    );

    expect(errors).toEqual([]);
  });
});

describe('stripMarkers and the fence newline', () => {
  it('drops the trailing newline every real fence carries', () => {
    // `fencesByMeta` keeps it, unlike `fenceOf`, and the player numbers every
    // split element — so the listing grew one phantom numbered blank line.
    expect(stripMarkers('int a = 1; // foto a\n').split('\n')).toEqual(['int a = 1;']);
  });
});
