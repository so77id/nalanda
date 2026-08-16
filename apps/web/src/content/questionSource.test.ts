import { describe, expect, it } from 'vitest';

import { headingSlugs, readQuestions } from './questionSource';

describe('headingSlugs', () => {
  it('slugs an h2 and a slide title, which both render as sections', () => {
    // A `<Slide title>` renders an `h2` (ADR-0021), so slide titles are
    // anchorable and are in fact where most anchors point.
    const source = [
      '## Qué significa static',
      '',
      '<Slide title="Compilar y ejecutar">',
      'x',
      '</Slide>',
    ].join('\n');
    expect(headingSlugs(source)).toEqual(['que-significa-static', 'compilar-y-ejecutar']);
  });

  it('ignores headings that are only inside a code fence', () => {
    // A Markdown comment in a shell listing is not a section, and counting it
    // would make a broken anchor resolve against something that never renders.
    const source = ['```bash', '## esto es un comentario', '```', '', '## Sección real'].join('\n');
    expect(headingSlugs(source)).toEqual(['seccion-real']);
  });

  it('does not treat h3 as a section', () => {
    expect(headingSlugs('### Subtítulo\n\n## Sección')).toEqual(['seccion']);
  });
});

describe('readQuestions', () => {
  it('reads id, anchor, statement and alternatives with their marks', () => {
    const source = [
      '<Question id="indice-cero" anchor="arreglos">',
      '',
      '¿Cuál es el índice del primer elemento?',
      '',
      '- [x] 0',
      '- [ ] 1',
      '- [ ] -1',
      '- [ ] Depende',
      '',
      '</Question>',
    ].join('\n');

    expect(readQuestions(source)).toEqual([
      {
        id: 'indice-cero',
        anchor: 'arreglos',
        statement: '¿Cuál es el índice del primer elemento?',
        alternatives: [
          { text: '0', correct: true },
          { text: '1', correct: false },
          { text: '-1', correct: false },
          { text: 'Depende', correct: false },
        ],
      },
    ]);
  });

  it('leaves anchor undefined when the question belongs to the whole document', () => {
    const source = ['<Question id="global">', '', '¿Con qué se aprueba?', '', '</Question>'].join(
      '\n',
    );
    expect(readQuestions(source)[0]?.anchor).toBeUndefined();
  });

  it('takes the statement from the prose, not from a code listing', () => {
    // The fence is its own field all the way to the printed sheet; letting it
    // become the statement would put a Java program where the question goes.
    const source = [
      '<Question id="suma" anchor="arreglos">',
      '',
      '¿Qué imprime este programa?',
      '',
      '```java',
      'int s = 0;',
      '```',
      '',
      '- [x] 6',
      '- [ ] 3',
      '</Question>',
    ].join('\n');

    expect(readQuestions(source)[0]?.statement).toBe('¿Qué imprime este programa?');
    expect(readQuestions(source)[0]?.alternatives).toHaveLength(2);
  });

  it('reads every question of a block, in document order', () => {
    const source = [
      '<Questions>',
      '<Question id="uno">',
      'A',
      '- [x] sí',
      '</Question>',
      '<Question id="dos">',
      'B',
      '- [x] no',
      '</Question>',
      '</Questions>',
    ].join('\n');

    expect(readQuestions(source).map(({ id }) => id)).toEqual(['uno', 'dos']);
  });

  it('finds nothing in a document that has no questions', () => {
    expect(readQuestions('## Sección\n\nProsa cualquiera.')).toEqual([]);
  });
});
