import { describe, expect, it } from 'vitest';

import { SectionBreak, Slide } from '../components';
import { contentMdxComponents } from '../content';

import { computeSlides } from './parser';

const H2 = contentMdxComponents.h2;
const DOC = { title: 'Mi documento' };

function titles(slides: ReturnType<typeof computeSlides>) {
  return slides.map((s) => s.title);
}

describe('computeSlides — auto mode', () => {
  it('returns only a cover slide for an empty document', () => {
    const slides = computeSlides([], DOC);
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ title: 'Mi documento' });
  });

  it('puts content before the first boundary into the cover slide', () => {
    const slides = computeSlides([<p key="a">intro</p>, <H2 key="b">Tema</H2>], DOC);
    expect(slides).toHaveLength(2);
    expect(slides[0]!.content).toHaveLength(1);
    expect(slides[1]!.title).toBe('Tema');
  });

  it('slices by h2 headings, using the heading text as slide title', () => {
    const slides = computeSlides(
      [
        <H2 key="1">La idea</H2>,
        <p key="2">uno</p>,
        <p key="3">dos</p>,
        <H2 key="4">Costo</H2>,
        <p key="5">tres</p>,
      ],
      DOC,
    );
    expect(titles(slides)).toEqual(['Mi documento', 'La idea', 'Costo']);
    expect(slides[1]!.content).toHaveLength(2);
    expect(slides[2]!.content).toHaveLength(1);
  });

  it('also recognizes plain h2 elements as boundaries', () => {
    const slides = computeSlides([<h2 key="1">Plano</h2>, <p key="2">x</p>], DOC);
    expect(titles(slides)).toEqual(['Mi documento', 'Plano']);
  });

  it('treats an explicit Slide container as one slide with its own children', () => {
    const slides = computeSlides(
      [
        <Slide key="1" title="Marcada">
          <p>dentro</p>
          <p>tambien dentro</p>
        </Slide>,
        <p key="2">suelto</p>,
        <H2 key="3">Seccion</H2>,
      ],
      DOC,
    );
    expect(titles(slides)).toEqual(['Mi documento', 'Marcada', undefined, 'Seccion']);
    expect(slides[1]!.content).toHaveLength(2);
    expect(slides[2]!.content).toHaveLength(1);
  });

  it('starts an untitled slide after a SectionBreak', () => {
    const slides = computeSlides(
      [<H2 key="1">Antes</H2>, <p key="2">a</p>, <SectionBreak key="3" />, <p key="4">b</p>],
      DOC,
    );
    expect(titles(slides)).toEqual(['Mi documento', 'Antes', undefined]);
    expect(slides[2]!.content).toHaveLength(1);
  });

  it('ignores whitespace text nodes (MDX interleaves "\\n" between siblings)', () => {
    const slides = computeSlides(
      [
        '\n',
        <Slide key="1" title="Sola">
          {'\n'}
        </Slide>,
        '\n',
        <H2 key="2">Otra</H2>,
        '\n',
      ],
      DOC,
    );
    expect(titles(slides)).toEqual(['Mi documento', 'Sola', 'Otra']);
    expect(slides[0]!.content).toHaveLength(0);
  });

  it('excludes the document h1 from slide content (the cover chrome owns the title)', () => {
    const slides = computeSlides(
      [<h1 key="1">Mi documento</h1>, <p key="2">intro</p>, <H2 key="3">Tema</H2>],
      DOC,
    );
    expect(slides[0]!.content).toHaveLength(1);
    expect(titles(slides)).toEqual(['Mi documento', 'Tema']);
  });

  it('drops empty untitled groups (e.g. SectionBreak straight into an h2)', () => {
    const slides = computeSlides(
      [<SectionBreak key="1" />, <H2 key="2">Unica</H2>, <p key="3">x</p>],
      DOC,
    );
    expect(titles(slides)).toEqual(['Mi documento', 'Unica']);
  });
});

describe('computeSlides — explicit mode', () => {
  it('includes only marked content: Slide containers and post-SectionBreak groups', () => {
    const slides = computeSlides(
      [
        <p key="1">prosa solo-libro</p>,
        <H2 key="2">Ignorada como corte</H2>,
        <Slide key="3" title="Uno">
          <p>a</p>
        </Slide>,
        <p key="4">tambien solo-libro</p>,
        <SectionBreak key="5" />,
        <p key="6">incluida</p>,
      ],
      { title: 'Doc', mode: 'explicit' },
    );
    expect(titles(slides)).toEqual(['Doc', 'Uno', undefined]);
    expect(slides[0]!.content).toHaveLength(0);
    expect(slides[2]!.content).toHaveLength(1);
  });
});
