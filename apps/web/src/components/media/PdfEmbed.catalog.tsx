import type { CatalogEntry } from '../../lib/catalogEntry';

import { PdfEmbed } from './PdfEmbed';

// Control 1's answer key, shared as "anyone with the link can view". Written as
// the share link rather than the preview one because that is what an author
// pastes — the examples show the component doing the rewrite.
const PAUTA = 'https://drive.google.com/file/d/1v3B7n1hAHUUXt1iUlAYTGvXVTXrmYlRT/view?usp=sharing';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const pdfEmbedCatalogEntry: CatalogEntry = {
  name: 'PdfEmbed',
  family: 'media',
  description:
    "A PDF shared from Google Drive, drawn by Drive's own viewer inside the page. The author replaces the file in Drive and the page follows, with no commit and no deploy.",
  whenToUse:
    "When the course publishes a document that already exists as a PDF and may change after publication — today that is an evaluation's pauta. " +
    "Drive draws the pages, not the browser: the browsers' own PDF viewers disagree (Brave shows only the first page, ADR-0047) and Chrome on Android shows nothing inside a frame, while Drive's viewer shows every page the same everywhere, with its own zoom, page counter and a pop-out button whose tab can download the file. " +
    'It shows the file as Drive renders it and does nothing else: it does not read, check or transform the file. What the file contains is the author’s decision. ' +
    'The `title` is a runtime contract rather than a type, for the same reason as <Figure>: an iframe carries no accessible name of its own. ' +
    "Unlike <SheetEmbed>, the frame is granted allow-same-origin, because Drive's viewer never finishes loading without it (measured, ADR-0076). That is safe only because the host is always drive.google.com, which the src check enforces. " +
    'A file that is not shared renders Google request-access page inside the rectangle — that is cross-origin and nothing here can detect it, so check the share setting yourself. ' +
    'Prefer a <Figure> for an image, and MDX for anything you would otherwise retype: this is a third-party frame, weighed like one.',
  props: [
    {
      name: 'src',
      type: 'string',
      description:
        'The share link, exactly as the Compartir button gives it (drive.google.com/file/d/.../view?usp=sharing), or the /file/u/0/d/... url out of the address bar. Required. It is rewritten into the /preview form, the bare viewer without Drive page chrome. Anything that is not a drive.google.com file url is refused — including a PDF url from another host, which this frame would otherwise run with allow-same-origin.',
    },
    {
      name: 'title',
      type: 'string',
      description:
        'What this document is, in Spanish (the page is served lang="es"). Required: it is the frame accessible name and there is no other source for one.',
    },
    {
      name: 'height',
      type: 'number',
      description:
        'How tall the frame is, in px. Defaults to 800, most of one US-letter page at the width of the reading column; the reader scrolls inside the frame for the rest. On a slide the frame is capped at 64vh whatever this says (ADR-0013 §5.1).',
    },
  ],
  examples: [
    {
      title: 'An evaluation pauta',
      code: `<PdfEmbed
  src="https://drive.google.com/file/d/1v3B7n1hAHUUXt1iUlAYTGvXVTXrmYlRT/view?usp=sharing"
  title="Pauta del Control 1"
/>`,
      render: () => <PdfEmbed src={PAUTA} title="Pauta del Control 1" />,
    },
    {
      title: 'Given no title',
      code: `<PdfEmbed src="https://drive.google.com/file/d/1v3B7n.../view?usp=sharing" />`,
      render: () => <PdfEmbed src={PAUTA} />,
    },
    {
      title: 'Given a PDF that is not in Drive',
      code: `<PdfEmbed src="https://example.com/pauta.pdf" title="Pauta" />`,
      render: () => <PdfEmbed src="https://example.com/pauta.pdf" title="Pauta" />,
    },
  ],
};
