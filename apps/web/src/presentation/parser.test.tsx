import { describe, expect, it } from 'vitest';

import { SectionBreak, Slide } from '../components';
import { contentMdxComponents } from '../content';

import { computeSlides } from './parser';

const H2 = contentMdxComponents.h2;
const DOC = { title: 'Mi documento' };

function titles(slides: ReturnType<typeof computeSlides>) {
  return slides.map((s) => s.title);
}

function slugs(slides: ReturnType<typeof computeSlides>) {
  return slides.map((s) => s.slug);
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

  it('gives each h2-derived slide a slug that matches its heading anchor', () => {
    // The book renders these h2s with id="la-idea" / id="costo" via mdxHeading.
    // The deep-link contract says both spines must resolve to the same slug —
    // sharing slugify(textOf(...)) is what keeps them agreeing.
    const slides = computeSlides(
      [<H2 key="1">La idea</H2>, <p key="2">x</p>, <H2 key="3">Costo</H2>],
      DOC,
    );
    expect(slugs(slides)).toEqual([undefined, 'la-idea', 'costo']);
  });

  it('slugs a <Slide title> the same way as an h2', () => {
    const slides = computeSlides(
      [
        <Slide key="1" title="Búsqueda binaria">
          <p>x</p>
        </Slide>,
      ],
      DOC,
    );
    expect(slugs(slides)).toEqual([undefined, 'busqueda-binaria']);
  });

  it('leaves the cover and a SectionBreak group without a slug', () => {
    const slides = computeSlides(
      [<H2 key="1">Antes</H2>, <SectionBreak key="2" />, <p key="3">a</p>],
      DOC,
    );
    // cover, "Antes", untitled post-break group.
    expect(slugs(slides)).toEqual([undefined, 'antes', undefined]);
  });

  it('gives a titled slide with no sluggable text no slug (the # anchor is silent too)', () => {
    // Same silent-fallback contract as mdxHeading.tsx: a heading whose content
    // is entirely an element (`## $$\log_2 n$$`) has no text and gets no id.
    // The slide-slug spine must not diverge from that. Prose after the heading
    // keeps the slide from being dropped as empty-untitled, so the case can
    // observe the slug rather than the parser's other silent behaviour.
    const slides = computeSlides([<H2 key="1">{<span key="x" />}</H2>, <p key="2">x</p>], DOC);
    expect(slugs(slides)).toEqual([undefined, undefined]);
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

  it('slugs the marked Slide and leaves the post-break group unslugged', () => {
    const slides = computeSlides(
      [
        <Slide key="1" title="Uno">
          <p>a</p>
        </Slide>,
        <SectionBreak key="2" />,
        <p key="3">b</p>,
      ],
      { title: 'Doc', mode: 'explicit' },
    );
    expect(slugs(slides)).toEqual([undefined, 'uno', undefined]);
  });
});
