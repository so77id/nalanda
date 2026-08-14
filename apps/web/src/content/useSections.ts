import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** One navigable section of a document: the rendered h2 and the id it is linked by. */
export interface Section {
  id: string;
  text: string;
}

// Where the reading line sits: a quarter of the way down the viewport. A heading
// above it belongs to the section the reader is in; the rest of the screen is
// that section's body.
const BAND_FRACTION = 0.25;

function readSections(container: HTMLElement): Section[] {
  return [...container.querySelectorAll('h2[id]')].map((heading) => {
    // The self-anchor is a sibling of the heading text (mdxHeading.tsx), so a
    // plain textContent would read "Tipos#".
    const clone = heading.cloneNode(true) as HTMLElement;
    for (const link of clone.querySelectorAll('a')) {
      if (link.getAttribute('href') === `#${heading.id}`) link.remove();
    }
    // A formula is emitted THREE times over: MathML glyphs for assistive
    // technology, an <annotation> holding the LaTeX source, and aria-hidden
    // spans that draw it. textContent concatenates all three, so "Costo de
    // $$\log_2 n$$" arrives as "Costo de log⁡2n\log_2 nlog2n" (#118 review).
    // Dropping what a screen reader also drops leaves the readable one.
    for (const hidden of clone.querySelectorAll('[aria-hidden="true"], annotation')) {
      hidden.remove();
    }
    return { id: heading.id, text: (clone.textContent ?? '').replace(/\s+/g, ' ').trim() };
  });
}

function sameSections(a: Section[], b: Section[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i]?.id && s.text === b[i]?.text);
}

/**
 * The section spine of a rendered document, read from the DOM: every h2 the
 * article painted, plus the one currently being read.
 *
 * It reads the *rendered* article rather than the source because that is the
 * one place both presentation modes agree — `<Slide title>` renders the same
 * MDX-mapped h2 as a `##` heading (ADR-0021). Reading the DOM also keeps the
 * build untouched and respects the import direction: `content/` must not reach
 * into the presentation parser.
 */
export function useSections(container: RefObject<HTMLElement | null>): {
  sections: Section[];
  activeId: string | undefined;
} {
  const [sections, setSections] = useState<Section[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const sync = () => {
      const next = readSections(element);
      setSections((prev) => (sameSections(prev, next) ? prev : next));
    };
    sync();

    // The document arrives behind Suspense: on the first effect the article is
    // still empty, so the spine has to be re-read when its children land.
    const observer = new MutationObserver(sync);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);

  useEffect(() => {
    const element = container.current;
    if (!element || sections.length === 0) return;

    // The section being read is the LAST heading that has passed the band —
    // a position, not a visibility. An IntersectionObserver was the first
    // implementation and it was wrong in a way only a browser showed: it fires
    // on crossings, and while a reader sits inside a long section no heading is
    // in the band, so nothing crosses and nothing fires. Measured on
    // /d/java-desde-cpp: the mark stayed empty through 70% of the document, and
    // any jump — a fragment link, a flick, restoring a scroll position — landed
    // with no mark at all.
    const decide = () => {
      const bandBottom = window.innerHeight * BAND_FRACTION;
      let current: string | undefined;
      for (const section of sections) {
        const heading = element.querySelector(`h2[id="${CSS.escape(section.id)}"]`);
        if (!heading) continue;
        if (heading.getBoundingClientRect().top > bandBottom) break;
        current = section.id;
      }
      setActiveId(current);
    };

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        decide();
      });
    };

    decide(); // Also covers landing on a #fragment, where no scroll event follows.
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [container, sections]);

  return { sections, activeId };
}
