import { describe, expect, it } from 'vitest';

import { readTrace } from './trace';

/**
 * Captured from a real run, not hand-written: Chromium against
 * `npm run build && npm run preview`, 2026-08-13, from the probe that verified
 * reflection works under CheerpJ. Two photographs of a program that aliases,
 * mutates through the alias, and holds a cycle.
 *
 * Hand-authoring this fixture would test the reader against the format someone
 * believed the tracer emits, which is the one thing worth not assuming.
 */
const REAL_OUTPUT = `[nalanda] T PASO 4 main
[nalanda] T VAR a ref 1
[nalanda] T VAR b ref 1
[nalanda] T OBJ 1 Punto
[nalanda] T FLD 1 x int 1
[nalanda] T FLD 1 y int 2
[nalanda] T FLD 1 siguiente null 0
[nalanda] T FINPASO
[nalanda] T PASO 20 main
[nalanda] T VAR a ref 1
[nalanda] T VAR b ref 1
[nalanda] T VAR n int 7
[nalanda] T VAR letra char z
[nalanda] T VAR s1 ref 2
[nalanda] T VAR s2 ref 3
[nalanda] T VAR v ref 4
[nalanda] T VAR nulo null 0
[nalanda] T VAR caja ref 5
[nalanda] T OBJ 1 Punto
[nalanda] T FLD 1 x int 99
[nalanda] T FLD 1 y int 2
[nalanda] T FLD 1 siguiente ref 6
[nalanda] T STR 2 hola mundo
[nalanda] T STR 3 hola mundo
[nalanda] T ARR 4 int 3
[nalanda] T ELM 4 0 int 1
[nalanda] T ELM 4 1 int 2
[nalanda] T ELM 4 2 int 3
[nalanda] T OBJ 5 java.lang.Integer
[nalanda] T FLD 5 value int 128
[nalanda] T OBJ 6 Punto
[nalanda] T FLD 6 x int 3
[nalanda] T FLD 6 y int 4
[nalanda] T FLD 6 siguiente ref 1
[nalanda] T FINPASO
[nalanda] T FINMARCO main`;

describe('readTrace', () => {
  it('reads both photographs out of a real run', () => {
    const { steps } = readTrace(REAL_OUTPUT);

    expect(steps).toHaveLength(2);
    expect(steps[0]!.line).toBe(4);
    expect(steps[1]!.line).toBe(20);
  });

  it('gives two aliased variables the same object id', () => {
    // The whole lesson of document 2 §1: `a` and `b` are two names, one box.
    const [first] = readTrace(REAL_OUTPUT).steps;
    const main = first!.frames.find((one) => one.name === 'main')!;

    expect(main.variables).toContainEqual({ name: 'a', value: { kind: 'ref', id: 1 } });
    expect(main.variables).toContainEqual({ name: 'b', value: { kind: 'ref', id: 1 } });
  });

  it('keeps primitives as values rather than as objects', () => {
    const main = readTrace(REAL_OUTPUT).steps[1]!.frames[0]!;

    expect(main.variables).toContainEqual({
      name: 'n',
      value: { kind: 'primitive', type: 'int', text: '7' },
    });
    expect(main.variables).toContainEqual({
      name: 'letra',
      value: { kind: 'primitive', type: 'char', text: 'z' },
    });
  });

  it('reads a field mutated between photographs', () => {
    const { steps } = readTrace(REAL_OUTPUT);
    const xOf = (step: (typeof steps)[number]) =>
      step.objects.find((one) => one.id === 1)!.fields.find((f) => f.name === 'x')!.value;

    expect(xOf(steps[0]!)).toEqual({ kind: 'primitive', type: 'int', text: '1' });
    expect(xOf(steps[1]!)).toEqual({ kind: 'primitive', type: 'int', text: '99' });
  });

  it('gives two equal strings two boxes', () => {
    // What makes `new String("hola") == new String("hola")` visible: equality
    // would merge these two and the drawing would refute the lesson.
    const strings = readTrace(REAL_OUTPUT).steps[1]!.objects.filter((o) => o.kind === 'string');

    expect(strings.map((one) => one.id)).toEqual([2, 3]);
    expect(new Set(strings.map((one) => one.text))).toEqual(new Set(['hola mundo']));
  });

  it('reads an array with its elements, and null as absence', () => {
    const step = readTrace(REAL_OUTPUT).steps[1]!;
    const array = step.objects.find((one) => one.id === 4)!;

    expect(array.kind).toBe('array');
    expect(array.type).toBe('int');
    expect(array.fields).toHaveLength(3);
    expect(array.fields[2]).toEqual({
      name: '2',
      value: { kind: 'primitive', type: 'int', text: '3' },
    });
    expect(step.frames[0]!.variables).toContainEqual({ name: 'nulo', value: { kind: 'null' } });
  });

  it('closes a cycle on an id it has already seen instead of recursing', () => {
    const step = readTrace(REAL_OUTPUT).steps[1]!;
    const tail = step.objects.find((one) => one.id === 6)!;

    expect(tail.fields).toContainEqual({ name: 'siguiente', value: { kind: 'ref', id: 1 } });
  });

  it('separates what the program printed from what the tracer did', () => {
    const reading = readTrace(
      ['hola desde el programa', ...REAL_OUTPUT.split('\n'), 'y adiós'].join('\n'),
    );

    expect(reading.output).toBe('hola desde el programa\ny adiós');
    expect(reading.steps).toHaveLength(2);
  });

  it('carries a frame that was not re-photographed into later steps', () => {
    // `swap` photographs its own two variables; main's stay on screen because
    // the drawing is the union of the last known state of every open frame.
    const reading = readTrace(
      [
        '[nalanda] T PASO 3 main',
        '[nalanda] T VAR a ref 1',
        '[nalanda] T OBJ 1 Punto',
        '[nalanda] T FLD 1 x int 1',
        '[nalanda] T FINPASO',
        '[nalanda] T PASO 9 swap',
        '[nalanda] T VAR p ref 1',
        '[nalanda] T OBJ 1 Punto',
        '[nalanda] T FLD 1 x int 1',
        '[nalanda] T FINPASO',
      ].join('\n'),
    );

    expect(reading.steps[1]!.frames.map((one) => one.name)).toEqual(['main', 'swap']);
    expect(reading.steps[1]!.frame).toBe('swap');
  });

  it('drops a frame once it is closed', () => {
    const reading = readTrace(
      [
        '[nalanda] T PASO 9 swap',
        '[nalanda] T VAR p ref 1',
        '[nalanda] T FINPASO',
        '[nalanda] T FINMARCO swap',
        '[nalanda] T PASO 12 main',
        '[nalanda] T VAR a ref 1',
        '[nalanda] T FINPASO',
      ].join('\n'),
    );

    expect(reading.steps[1]!.frames.map((one) => one.name)).toEqual(['main']);
  });

  it('reports a cap instead of pretending the trace was complete', () => {
    const reading = readTrace(
      [
        '[nalanda] T PASO 3 main',
        '[nalanda] T VAR a ref 1',
        '[nalanda] T TOPE objetos',
        '[nalanda] T FINPASO',
        '[nalanda] T TOPE pasos',
      ].join('\n'),
    );

    expect(reading.steps[0]!.truncated).toBe('objetos');
    expect(reading.truncated).toBe('pasos');
  });

  it('restores newlines a string carried', () => {
    const reading = readTrace(
      [
        '[nalanda] T PASO 1 main',
        '[nalanda] T VAR s ref 1',
        '[nalanda] T STR 1 primera\\nsegunda',
        '[nalanda] T FINPASO',
      ].join('\n'),
    );

    expect(reading.steps[0]!.objects[0]!.text).toBe('primera\nsegunda');
  });

  it('reads nothing out of a program that never traced', () => {
    const reading = readTrace('solo salida normal\nsin marcas');

    expect(reading.steps).toEqual([]);
    expect(reading.output).toBe('solo salida normal\nsin marcas');
  });
});
