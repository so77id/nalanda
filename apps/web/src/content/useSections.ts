import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** One navigable section of a document: the rendered h2 and the id it is linked by. */
export interface Section {
  id: string;
  text: string;
}

// The band the active section is decided in: the top 25% of the viewport. A
// heading entering it is what a reader calls "the section I am in"; the rest of
// the screen is that section's body.
const READING_BAND = '0px 0px -75% 0px';

function readSections(container: HTMLElement): Section[] {
  return [...container.querySelectorAll('h2[id]')].map((heading) => {
    // The self-anchor is a sibling of the heading text (mdxHeading.tsx), so a
    // plain textContent would read "Tipos#".
    const clone = heading.cloneNode(true) as HTMLElement;
    for (const link of clone.querySelectorAll('a')) {
      if (link.getAttribute('href') === `#${heading.id}`) link.remove();
    }
    return { id: heading.id, text: (clone.textContent ?? '').trim() };
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
    // Older browsers and jsdom have no IntersectionObserver: the list still
    // renders and still navigates, it just never marks a section.
    if (!element || sections.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const inBand = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inBand.add(entry.target.id);
          else inBand.delete(entry.target.id);
        }
        // Topmost wins when several share the band; when none does, the reader
        // is inside the last one's body and the mark stays where it was.
        const topmost = sections.find((section) => inBand.has(section.id));
        if (topmost) setActiveId(topmost.id);
      },
      { rootMargin: READING_BAND, threshold: 0 },
    );
    for (const section of sections) {
      const heading = element.querySelector(`h2[id="${section.id}"]`);
      if (heading) observer.observe(heading);
    }
    return () => observer.disconnect();
  }, [container, sections]);

  return { sections, activeId };
}
