import type { CatalogEntry } from '../../lib/catalogEntry';
import { ModeProvider } from '../../presentation';

import { Slide } from './Slide';

/** Catalog entry (ADR-0010) — colocated with the component, exported via the seam. */
export const slideCatalogEntry: CatalogEntry = {
  name: 'Slide',
  family: 'structure',
  description:
    'Explicit slide boundary. In the book it reads as a normal section (heading + flowing prose); in presentation mode it becomes one slide whose title is the viewer chrome.',
  whenToUse:
    'When a section of the document should be exactly one slide — especially with presentation: explicit, where ONLY marked content forms the deck. Prefer plain h2 sections when auto slicing already gives the deck you want.',
  props: [
    {
      name: 'title',
      type: 'string',
      description:
        'Section heading in the book; slide title in the presentation. PLAIN TEXT — it is a JSX attribute, so markdown and mathematics are not processed: a `$$…$$` here ships literal dollar signs to the reader, projected, past a green build (#118). Put a formula in the slide body instead.',
    },
    {
      name: 'children',
      type: 'ReactNode',
      description: 'The slide content — flows as prose in the book.',
    },
  ],
  examples: [
    {
      title: 'Book mode (default): heading + flowing prose',
      code: '<Slide title="La idea">\n  Comparamos el objetivo con el elemento del medio…\n</Slide>',
      render: () => (
        <Slide title="La idea">
          <p>Comparamos el objetivo con el elemento del medio…</p>
        </Slide>
      ),
    },
    {
      title: 'Presentation mode: children only (the title becomes viewer chrome)',
      code: '<ModeProvider mode="presentation">\n  <Slide title="La idea">…</Slide>\n</ModeProvider>',
      render: () => (
        <ModeProvider mode="presentation">
          <Slide title="La idea">
            <p>Comparamos el objetivo con el elemento del medio…</p>
          </Slide>
        </ModeProvider>
      ),
    },
  ],
};
