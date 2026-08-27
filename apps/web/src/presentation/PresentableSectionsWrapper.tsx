import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { PresentableSectionsProvider } from '../lib/presentableSections';

import { mdxChildrenOf } from './mdxChildren';
import { computeSlides } from './parser';

interface Props {
  docId: string;
  title: string;
  /** Parser mode from the document frontmatter (auto | explicit). */
  configMode?: 'auto' | 'explicit';
  children?: ReactNode;
}

/**
 * The book-side counterpart to `SlideDeck`'s deck-building wrapper: same
 * technique — `mdxChildrenOf` → `computeSlides` — but instead of painting
 * a deck, it collects the slugs of the slide-titled slides and hands the
 * set down through context so `mdxHeading` can decide whether to paint the
 * "Presentar sección" button next to a given h2. The rendered children are
 * passed through unchanged; the book layout upstream still owns painting.
 *
 * Composed by `DocumentPage` as the MDX `wrapper` component, so the whole
 * rendered document is available to walk in one go — the shape the
 * `mdxChildrenOf` docs promise and that `PresentationPage`'s DeckWrapper
 * already relies on.
 */
export function PresentableSectionsWrapper({ docId, title, configMode = 'auto', children }: Props) {
  // Unconditional and first: mdxChildrenOf runs a useContext internally.
  const siblings = mdxChildrenOf(children);
  const value = useMemo(() => {
    const slugs = new Set<string>();
    for (const slide of computeSlides(siblings, { title, mode: configMode })) {
      if (slide.slug) slugs.add(slide.slug);
    }
    return { docId, presentableSlugs: slugs };
  }, [siblings, title, configMode, docId]);
  return <PresentableSectionsProvider value={value}>{children}</PresentableSectionsProvider>;
}
