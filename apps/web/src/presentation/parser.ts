import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';

import { metaOf } from '../lib/componentMeta';
import { textOf } from '../lib/reactText';

export interface SlideDef {
  title?: string;
  content: ReactNode[];
}

interface Options {
  /** Document title — becomes the cover slide. */
  title: string;
  /** auto: h2 headings also cut slides; explicit: only markers do, loose prose is book-only. */
  mode?: 'auto' | 'explicit';
}

function isH2(child: ReactNode): child is React.ReactElement {
  if (!isValidElement(child)) return false;
  return child.type === 'h2' || metaOf(child.type).headingLevel === 2;
}

/**
 * Pure slide computation over the MDX-rendered element array (the same list
 * both modes paint). Boundaries: <Slide> containers, <SectionBreak/>, and —
 * in auto mode — h2 headings. Content before the first boundary joins the
 * cover slide (auto) or stays book-only (explicit). Empty untitled groups
 * are dropped; the cover always exists.
 */
export function computeSlides(children: ReactNode, { title, mode = 'auto' }: Options): SlideDef[] {
  const auto = mode === 'auto';
  const slides: SlideDef[] = [];
  const cover: SlideDef = { title, content: [] };
  slides.push(cover);

  // The group open for loose siblings; null when loose content is not collected
  // (explicit mode outside any post-SectionBreak group).
  let open: SlideDef | null = auto ? cover : null;

  const closeIfEmpty = () => {
    const last = slides[slides.length - 1];
    if (last && last !== cover && last === open && !last.title && last.content.length === 0) {
      slides.pop();
    }
  };

  for (const child of Children.toArray(children)) {
    // MDX interleaves "\n" text nodes between siblings — never content.
    if (typeof child === 'string' && child.trim() === '') continue;
    if (isValidElement(child)) {
      // The document h1 never enters a slide: the cover chrome owns the title.
      if (child.type === 'h1' || metaOf(child.type).headingLevel === 1) continue;
      const boundary = metaOf(child.type).slideBoundary;
      if (boundary === 'slide') {
        closeIfEmpty();
        const props = child.props as { title?: string; children?: ReactNode };
        slides.push({ title: props.title, content: Children.toArray(props.children) });
        open = null;
        continue;
      }
      if (boundary === 'section-break') {
        closeIfEmpty();
        open = { title: undefined, content: [] };
        slides.push(open);
        continue;
      }
      if (auto && isH2(child)) {
        closeIfEmpty();
        open = { title: textOf((child.props as { children?: ReactNode }).children), content: [] };
        slides.push(open);
        continue;
      }
    }
    if (open === null) {
      // Loose content after an explicit Slide: auto opens an untitled group;
      // explicit keeps it book-only.
      if (!auto) continue;
      open = { title: undefined, content: [] };
      slides.push(open);
    }
    open.content.push(child);
  }
  closeIfEmpty();
  return slides;
}
