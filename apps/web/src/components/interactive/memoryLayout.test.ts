import { describe, expect, it } from 'vitest';

import type { TraceStep } from './trace';
import { describeStep, layoutStep } from './memoryLayout';

const step = (over: Partial<TraceStep> = {}): TraceStep => ({
  line: 1,
  frame: 'main',
  frames: [],
  objects: [],
  truncated: null,
  ...over,
});

const ref = (id: number) => ({ kind: 'ref' as const, id });
const int = (text: string) => ({ kind: 'primitive' as const, type: 'int', text });

describe('layoutStep', () => {
  it('gives every variable of every frame a box', () => {
    const { variables } = layoutStep(
      step({
        frames: [
          { name: 'main', variables: [{ name: 'a', value: ref(1) }] },
          { name: 'swap', variables: [{ name: 'p', value: ref(1) }] },
        ],
      }),
    );

    expect(variables.map((one) => one.name)).toEqual(['a', 'p']);
    expect(variables.map((one) => one.frame)).toEqual(['main', 'swap']);
  });

  it('stacks frames without overlapping them', () => {
    const { frames } = layoutStep(
      step({
        frames: [
          { name: 'main', variables: [{ name: 'a', value: int('1') }] },
          { name: 'swap', variables: [{ name: 'p', value: int('2') }] },
        ],
      }),
    );

    expect(frames[1]!.y).toBeGreaterThanOrEqual(frames[0]!.y + frames[0]!.height);
  });

  it('draws an arrow for a reference and none for a primitive', () => {
    const { arrows } = layoutStep(
      step({
        frames: [
          {
            name: 'main',
            variables: [
              { name: 'a', value: ref(1) },
              { name: 'n', value: int('7') },
            ],
          },
        ],
        objects: [{ id: 1, kind: 'object', type: 'Punto', fields: [] }],
      }),
    );

    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ fromId: 'main.a', toId: 1 });
  });

  it('shows a primitive value inside its box', () => {
    const { variables } = layoutStep(
      step({ frames: [{ name: 'main', variables: [{ name: 'n', value: int('7') }] }] }),
    );

    expect(variables[0]!.text).toBe('7');
    expect(variables[0]!.target).toBeNull();
  });

  it('marks null as absence rather than leaving the box blank', () => {
    const { variables, arrows } = layoutStep(
      step({ frames: [{ name: 'main', variables: [{ name: 's', value: { kind: 'null' } }] }] }),
    );

    expect(variables[0]!.isNull).toBe(true);
    expect(variables[0]!.text).toBe('null');
    expect(arrows).toHaveLength(0);
  });

  it('points two aliased variables at one box', () => {
    // Two arrows, one target: the drawing of document 2 §1.
    const { arrows, objects } = layoutStep(
      step({
        frames: [
          {
            name: 'main',
            variables: [
              { name: 'a', value: ref(1) },
              { name: 'b', value: ref(1) },
            ],
          },
        ],
        objects: [{ id: 1, kind: 'object', type: 'Punto', fields: [] }],
      }),
    );

    expect(objects).toHaveLength(1);
    expect(arrows.map((one) => one.toId)).toEqual([1, 1]);
  });

  it('draws an arrow from a field that references another object', () => {
    const { arrows } = layoutStep(
      step({
        frames: [{ name: 'main', variables: [{ name: 'a', value: ref(1) }] }],
        objects: [
          { id: 1, kind: 'object', type: 'Nodo', fields: [{ name: 'sig', value: ref(2) }] },
          { id: 2, kind: 'object', type: 'Nodo', fields: [] },
        ],
      }),
    );

    expect(arrows).toContainEqual(expect.objectContaining({ fromId: 'obj1.sig', toId: 2 }));
  });

  it('routes a field arrow around the outside instead of back across the lane', () => {
    // Drawn like a variable arrow, a linked list's `siguiente` crossed the gap
    // between the columns and buried the arrows that carry the lesson.
    const { arrows, objects, width } = layoutStep(
      step({
        objects: [
          { id: 1, kind: 'object', type: 'Nodo', fields: [{ name: 'sig', value: ref(2) }] },
          { id: 2, kind: 'object', type: 'Nodo', fields: [] },
        ],
      }),
    );

    const field = arrows.find((one) => one.fromField)!;
    const target = objects.find((one) => one.id === 2)!;

    expect(field.x2).toBe(target.x + target.width);
    // And the canvas grew to hold the detour, rather than clipping it.
    expect(width).toBeGreaterThan(target.x + target.width);
  });

  it('titles boxes the way a student would name them', () => {
    const { objects } = layoutStep(
      step({
        objects: [
          { id: 1, kind: 'object', type: 'java.lang.Integer', fields: [] },
          { id: 2, kind: 'string', type: 'String', text: 'hola', fields: [] },
          { id: 3, kind: 'array', type: 'int', fields: [{ name: '0', value: int('5') }] },
        ],
      }),
    );

    // The package would be noise: a student writes Integer, not java.lang.Integer.
    expect(objects.map((one) => one.title)).toEqual(['Integer', 'String', 'int[1]']);
  });

  it('shows a string as its text, so two equal strings read as two boxes', () => {
    const { objects } = layoutStep(
      step({
        objects: [
          { id: 1, kind: 'string', type: 'String', text: 'hola', fields: [] },
          { id: 2, kind: 'string', type: 'String', text: 'hola', fields: [] },
        ],
      }),
    );

    expect(objects.map((one) => one.rows[0]!.text)).toEqual(['"hola"', '"hola"']);
    expect(objects[0]!.y).not.toBe(objects[1]!.y);
  });

  it('sizes the canvas to hold everything it drew', () => {
    const layout = layoutStep(
      step({
        frames: [{ name: 'main', variables: [{ name: 'a', value: ref(1) }] }],
        objects: [
          { id: 1, kind: 'object', type: 'Punto', fields: [{ name: 'x', value: int('1') }] },
        ],
      }),
    );

    const lowest = Math.max(
      ...layout.objects.map((one) => one.y + one.height),
      ...layout.frames.map((one) => one.y + one.height),
    );
    expect(layout.height).toBeGreaterThanOrEqual(lowest);
    expect(layout.width).toBeGreaterThan(0);
  });
});

describe('describeStep', () => {
  it('describes the state in Spanish, for a reader who cannot see it', () => {
    // The page is served lang="es": an English description would be announced
    // with Spanish phonemes (root CLAUDE.md §Language).
    const text = describeStep(
      step({
        frames: [
          {
            name: 'main',
            variables: [
              { name: 'a', value: ref(1) },
              { name: 'b', value: ref(1) },
              { name: 'n', value: int('7') },
            ],
          },
        ],
        objects: [{ id: 1, kind: 'object', type: 'Punto', fields: [] }],
      }),
    );

    expect(text).toMatch(/main/);
    expect(text).toMatch(/a y b apuntan al mismo objeto/i);
    expect(text).toMatch(/n vale 7/i);
  });

  it('says which variables of different frames share a box', () => {
    // Per-frame grouping alone described the swap as four references to
    // indistinguishable Puntos, and a reader who cannot see the arrows had no
    // way to tell that `q` and `a` are the same box — the whole lesson.
    const text = describeStep(
      step({
        frames: [
          {
            name: 'main',
            variables: [
              { name: 'a', value: ref(1) },
              { name: 'b', value: ref(2) },
            ],
          },
          {
            name: 'intercambia',
            variables: [
              { name: 'p', value: ref(2) },
              { name: 'q', value: ref(1) },
            ],
          },
        ],
        objects: [
          { id: 1, kind: 'object', type: 'Punto', fields: [] },
          { id: 2, kind: 'object', type: 'Punto', fields: [] },
        ],
      }),
    );

    expect(text).toMatch(/main\.a y intercambia\.q/);
    expect(text).toMatch(/main\.b y intercambia\.p/);
  });

  it('stays quiet about sharing when there is only one frame', () => {
    const text = describeStep(
      step({
        frames: [
          {
            name: 'main',
            variables: [
              { name: 'a', value: ref(1) },
              { name: 'b', value: ref(1) },
            ],
          },
        ],
        objects: [{ id: 1, kind: 'object', type: 'Punto', fields: [] }],
      }),
    );

    // Already said, and better, by the per-frame sentence.
    expect(text).not.toMatch(/Apuntan al mismo objeto:/);
    expect(text).toMatch(/a y b apuntan al mismo objeto/);
  });

  it('says a variable is null rather than omitting it', () => {
    const text = describeStep(
      step({ frames: [{ name: 'main', variables: [{ name: 's', value: { kind: 'null' } }] }] }),
    );

    expect(text).toMatch(/s.*no apunta a ning[úu]n objeto/i);
  });
});
