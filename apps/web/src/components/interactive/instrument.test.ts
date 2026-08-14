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
    // The runtime guard only inspects the ENTRY class, so a secondary class
    // named NalandaTrace would compile and overwrite the one collecting the
    // trace — the diagram would then draw whatever the author's version emitted.
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
