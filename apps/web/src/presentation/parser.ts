import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';

import { metaOf } from '../lib/componentMeta';
import { textOf } from '../lib/reactText';
import { slugify } from '../lib/slug';

export interface SlideDef {
  title?: string;
  /**
   * Deep-link slug for the slide. Same `slugify(textOf(title))` recipe the
   * book uses for its h2 anchors (`content/mdxHeading.tsx`) — sharing the
   * function is how the two spines stay in agreement, so `?section=<slug>`
   * on presentation and `#<slug>` on the book resolve to the same heading.
   * Absent on the cover (title is the document's own name — the "Presentar"
   * button already lands there) and on SectionBreak groups (anonymous by
   * design, ADR-0010). A title whose text is empty — e.g. a heading whose
   * content is entirely a formula, per `mdxHeading.tsx` and `reactText.ts` —
   * yields no slug here for the same silent-fallback reason.
   */
  slug?: string;
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
/**
 * Slug for a slide title, or undefined when the title is missing or has no
 * text to slug (see `SlideDef.slug` for the silent-fallback rationale — the
 * book's h2 anchor does the same thing for the same reason).
 */
function slugFor(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const slug = slugify(title);
  return slug ? slug : undefined;
}

/**
 * The heading text a Slide/h2 boundary contributes as its title, and — for a
 * <Slide title> — as its slug source. Explicit-mode Slide markers pass their
 * title as a prop (a plain string); auto-mode h2 headings carry it as
 * children (`textOf` collapses the subtree).
 */
function titleTextOf(children: ReactNode | undefined): string {
  return textOf(children);
}

export function computeSlides(children: ReactNode, { title, mode = 'auto' }: Options): SlideDef[] {
  const auto = mode === 'auto';
  const slides: SlideDef[] = [];
  // Cover: no slug on purpose — the top-bar "Presentar" button already lands
  // there, so `#doc-title` on exit would round-trip the reader to the top of
  // the book they were already at.
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
        slides.push({
          title: props.title,
          slug: slugFor(props.title),
          content: Children.toArray(props.children),
        });
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
        const heading = titleTextOf((child.props as { children?: ReactNode }).children);
        open = { title: heading, slug: slugFor(heading), content: [] };
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
