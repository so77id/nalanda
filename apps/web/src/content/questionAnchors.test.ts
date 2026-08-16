import { describe, expect, it } from 'vitest';

import { headingSlugs, questionAnchors, unresolvedAnchors } from './questionAnchors';

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

describe('questionAnchors', () => {
  it('reads the id and anchor of every anchored question', () => {
    const source = [
      '<Question id="uno" anchor="seccion-a">',
      '</Question>',
      '<Question id="dos">',
      '</Question>',
      '<Question id="tres" anchor="seccion-b">',
      '</Question>',
    ].join('\n');
    expect(questionAnchors(source)).toEqual([
      { id: 'uno', anchor: 'seccion-a' },
      { id: 'tres', anchor: 'seccion-b' },
    ]);
  });
});

describe('unresolvedAnchors', () => {
  it('names the questions whose anchor matches no section', () => {
    const source = [
      '## Sección buena',
      '',
      '<Question id="ok" anchor="seccion-buena">',
      '</Question>',
      '<Question id="roto" anchor="seccion-que-no-existe">',
      '</Question>',
    ].join('\n');
    expect(unresolvedAnchors(source)).toEqual([{ id: 'roto', anchor: 'seccion-que-no-existe' }]);
  });

  it('says nothing about a question with no anchor', () => {
    // An unanchored question belongs to the whole document on purpose; it is
    // not a question missing its anchor.
    const source = '## Sección\n\n<Question id="global">\n</Question>';
    expect(unresolvedAnchors(source)).toEqual([]);
  });
});
