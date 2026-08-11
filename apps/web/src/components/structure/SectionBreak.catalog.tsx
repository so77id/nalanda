import type { CatalogEntry } from '../../lib/catalogEntry';
import { ModeProvider } from '../../presentation';

import { SectionBreak } from './SectionBreak';

/** Catalog entry (ADR-0010) — colocated with the component, exported via the seam. */
export const sectionBreakCatalogEntry: CatalogEntry = {
  name: 'SectionBreak',
  family: 'estructura',
  description:
    'Slide boundary without a heading. In the book it reads as a subtle divider; in presentation mode it cuts a new untitled slide and renders nothing itself.',
  whenToUse:
    'When the deck needs a cut that the book should barely notice — e.g., a closing remark on its own slide, or including unmarked prose in an explicit deck.',
  props: [],
  examples: [
    {
      title: 'Book mode (default): a subtle divider between paragraphs',
      code: '<p>Antes…</p>\n<SectionBreak />\n<p>Después…</p>',
      render: () => (
        <>
          <p>Antes…</p>
          <SectionBreak />
          <p>Después…</p>
        </>
      ),
    },
    {
      title: 'Presentation mode: renders nothing (the parser consumes the boundary)',
      code: '<ModeProvider mode="presentation">\n  <p>Antes…</p>\n  <SectionBreak />\n  <p>Después…</p>\n</ModeProvider>',
      render: () => (
        <ModeProvider mode="presentation">
          <p>Antes…</p>
          <SectionBreak />
          <p>Después…</p>
        </ModeProvider>
      ),
    },
  ],
};
