import { describe, expect, it } from 'vitest';

import { buildBank } from './questionBank';

const JAVA = [
  '<Slide title="Qué significa static">',
  'texto',
  '</Slide>',
  '',
  '<Slide title="Arreglos">',
  'texto',
  '</Slide>',
  '',
  '<Questions>',
  '',
  '<Question id="static-sin-objeto" anchor="que-significa-static">',
  '',
  '¿Por qué `main` tiene que ser `static`?',
  '',
  '- [x] Porque la máquina virtual lo llama sin crear ningún objeto',
  '- [ ] Porque así corre más rápido',
  '- [ ] Porque solo los `static` imprimen',
  '- [ ] Porque lo exige el `.class`',
  '',
  '</Question>',
  '',
  '<Question id="cuales-compilan" anchor="arreglos">',
  '',
  '¿Cuáles compilan?',
  '',
  '```java',
  'int[] v = {1, 2};',
  '```',
  '',
  '- [x] La primera',
  '- [x] La segunda',
  '- [ ] La tercera',
  '- [ ] La cuarta',
  '',
  '</Question>',
  '',
  '</Questions>',
].join('\n');

const WELCOME = [
  '## Evaluación',
  '',
  '<Question id="con-cuanto-se-aprueba">',
  '',
  '¿Con qué porcentaje se aprueba?',
  '',
  '- [x] 50%',
  '- [ ] 60%',
  '- [ ] 40%',
  '- [ ] 70%',
  '',
  '</Question>',
].join('\n');

function bank() {
  return buildBank([
    { id: 'bienvenida', title: 'Bienvenida', coverage: 'pool', source: WELCOME },
    { id: 'java-desde-cpp', title: 'Java desde C++', coverage: 'per-section', source: JAVA },
  ]);
}

describe('buildBank', () => {
  it('carries the reading order and each document’s sections in order', () => {
    // What lets the server resolve "from section X to section Y" without ever
    // reading content/ (design C14).
    expect(bank().documents).toEqual([
      { id: 'bienvenida', title: 'Bienvenida', coverage: 'pool', sections: ['evaluacion'] },
      {
        id: 'java-desde-cpp',
        title: 'Java desde C++',
        coverage: 'per-section',
        sections: ['que-significa-static', 'arreglos'],
      },
    ]);
  });

  it('derives the type and names every correct alternative', () => {
    const questions = bank().questions;
    const simple = questions.find((q) => q.id === 'static-sin-objeto');
    const multiple = questions.find((q) => q.id === 'cuales-compilan');

    expect(simple?.type).toBe('simple');
    expect(simple?.correct).toEqual([0]);
    expect(multiple?.type).toBe('multiple');
    // A SET, not a single value — the whole reason the artifact changed shape.
    expect(multiple?.correct).toEqual([0, 1]);
  });

  it('carries code as its own field, never folded into the statement', () => {
    const withCode = bank().questions.find((q) => q.id === 'cuales-compilan');
    expect(withCode?.code).toEqual({ language: 'java', source: 'int[] v = {1, 2};' });
    expect(withCode?.statement).toBe('¿Cuáles compilan?');
  });

  it('says which document a question came from, and keeps null for no anchor', () => {
    const questions = bank().questions;
    expect(questions.find((q) => q.id === 'con-cuanto-se-aprueba')).toMatchObject({
      document: 'bienvenida',
      anchor: null,
    });
    expect(questions.find((q) => q.id === 'static-sin-objeto')?.anchor).toBe(
      'que-significa-static',
    );
  });

  it('is stable enough to diff: questions follow document order, then document order', () => {
    expect(bank().questions.map((q) => q.id)).toEqual([
      'con-cuanto-se-aprueba',
      'static-sin-objeto',
      'cuales-compilan',
    ]);
  });

  it('refuses two questions sharing an id', () => {
    // The id is the join key all the way to a grade (ADR-0031). Two questions
    // sharing one would silently merge two students' answers into one column.
    expect(() =>
      buildBank([
        { id: 'a', title: 'A', coverage: 'pool', source: WELCOME },
        { id: 'b', title: 'B', coverage: 'pool', source: WELCOME },
      ]),
    ).toThrow(/con-cuanto-se-aprueba/);
  });
});
