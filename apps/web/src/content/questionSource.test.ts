import { describe, expect, it } from 'vitest';

import { headingSlugs, readQuestions } from './questionSource';

describe('headingSlugs', () => {
  it('slugs an h2 and a slide title, which both render as sections', () => {
    // A `<Slide title>` renders an `h2` (ADR-0021), so slide titles are
    // anchorable and are in fact where most anchors point.
    // The slide is written FIRST on purpose. With the `##` first, a two-pass
    // implementation (all h2, then all slides) agrees with document order by
    // accident — which is exactly how the ordering bug shipped into the
    // published artifact and stayed green here.
    const source = [
      '<Slide title="Compilar y ejecutar">',
      'x',
      '</Slide>',
      '',
      '## Qué significa static',
    ].join('\n');
    expect(headingSlugs(source)).toEqual(['compilar-y-ejecutar', 'que-significa-static']);
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

  it('keeps a question’s code as its own field, with its language', () => {
    // Its own field all the way to the printed sheet: the generator writes it to
    // a separate file and `\lstinputlisting` reads it verbatim, so no brace or
    // backslash ever needs escaping into a .tex.
    const source = [
      '<Question id="suma" anchor="arreglos">',
      '',
      '¿Qué imprime?',
      '',
      '```java',
      'int[] v = {1, 2, 3};',
      'System.out.println(v.length);',
      '```',
      '',
      '- [x] 3',
      '- [ ] 2',
      '</Question>',
    ].join('\n');

    expect(readQuestions(source)[0]?.code).toEqual({
      language: 'java',
      source: 'int[] v = {1, 2, 3};\nSystem.out.println(v.length);',
    });
  });

  it('leaves code undefined when the question carries none', () => {
    const source = ['<Question id="sin">', '¿Cuál?', '- [x] a', '</Question>'].join('\n');
    expect(readQuestions(source)[0]?.code).toBeUndefined();
  });

  it('does not mistake a fence outside a question for its code', () => {
    const source = [
      '```java',
      'int fuera = 1;',
      '```',
      '<Question id="limpia">',
      '¿Cuál?',
      '- [x] a',
      '</Question>',
    ].join('\n');
    expect(readQuestions(source)[0]?.code).toBeUndefined();
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

  it('keeps a statement that was wrapped onto a second line', () => {
    // The prose in these documents is hard-wrapped near 80 columns, and nothing
    // formats `content/` — it sits outside `apps/web`, so prettier never visits
    // it. Reading only the first line truncated the question in the artifact
    // while the page showed it whole, which is a half-question on a printed,
    // graded sheet.
    const source = [
      '<Question id="gc" anchor="sec">',
      '',
      '¿Cuál de estas afirmaciones sobre el recolector de basura',
      'es cierta en el caso general?',
      '',
      '- [x] Libera la memoria de los objetos que ya no son alcanzables',
      '      desde ninguna referencia viva',
      '- [ ] Se ejecuta en un momento predecible',
      '</Question>',
    ].join('\n');

    const [q] = readQuestions(source);
    expect(q?.statement).toBe(
      '¿Cuál de estas afirmaciones sobre el recolector de basura es cierta en el caso general?',
    );
    expect(q?.alternatives[0]?.text).toBe(
      'Libera la memoria de los objetos que ya no son alcanzables desde ninguna referencia viva',
    );
  });

  it('finds nothing in a document that has no questions', () => {
    expect(readQuestions('## Sección\n\nProsa cualquiera.')).toEqual([]);
  });
});
