import type { CatalogEntry } from '../../lib/catalogEntry';

import { SheetEmbed } from './SheetEmbed';

// The course's own plan, shared as "anyone with the link can view". Written
// here as the share link rather than the preview one precisely because that is
// what an author pastes — the examples show the component doing the rewrite.
const PLAN =
  'https://docs.google.com/spreadsheets/d/1_cxMUbcF9Tscd3_4Nu71HiXy-MZuaz28IapmvhS7FkM/edit?usp=sharing';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const sheetEmbedCatalogEntry: CatalogEntry = {
  name: 'SheetEmbed',
  family: 'media',
  description:
    'A shared Google Sheet, framed read-only inside the page. The author edits the spreadsheet and the page follows, with no commit and no deploy.',
  whenToUse:
    'When what the course needs to publish already lives in a spreadsheet and changes on its own schedule — today that is the week-by-week plan. NOT grades, and nothing else carrying student identifiers: a link-shared sheet is public, there is no student login to put in front of it, and the disposition until one exists is not to ship that data this way (docs/security-notes.md, ADR-0035). A table typed into MDX is wrong the first time a class moves; this one is never re-typed. ' +
    'It shows the sheet as Google renders it and does nothing else: it does not read the data, does not know the columns, and transforms nothing. Tidying happens in the spreadsheet. ' +
    'The `title` is a runtime contract rather than a type, for the same reason as <Figure>: an iframe carries no accessible name of its own, so a frame without one is announced as an unnamed region the reader cannot identify or skip. ' +
    'Prefer a table typed into MDX for anything genuinely static: this is the most expensive thing the site serves — one frame costs about 10 requests and 570 kB on a first visit, roughly 2.9 times the whole application entry chunk (ADR-0035). It earns that only when the data changes on its own and a typed copy would go stale. ' +
    'Two more things about the frame are worth knowing before you use it. It paints its own white ground, so in the dark theme it is a white rectangle. And a sheet that is not shared renders Google request-access page inside the rectangle — that is cross-origin and nothing here can detect it, so check the share setting yourself.',
  props: [
    {
      name: 'src',
      type: 'string',
      description:
        'The share link, exactly as the Compartir button gives it — or the /spreadsheets/u/0/d/... url out of the address bar. Required. It is rewritten into the embeddable /preview form, because the /edit url Google hands you frames the EDITOR — not blocked, but its own requests fail inside the sandbox and it paints the grid behind an error dialog. The gid is carried across when the link points at one tab of several, but THAT part is unverified (see sheetUrl.ts): check the published page if you use a multi-tab sheet. The Publicar-en-la-web url is a different identifier entirely and is refused. So is anything that is not a docs.google.com spreadsheet url.',
    },
    {
      name: 'title',
      type: 'string',
      description:
        'What this sheet is, in Spanish (the page is served lang="es"). Required: it is the frame accessible name and there is no other source for one.',
    },
    {
      name: 'height',
      type: 'number',
      description:
        'How tall the frame is, in px. Defaults to 480, which is about nine rows of the course plan. An iframe has no content-driven height, so this is a decision rather than a fallback. On a slide the frame is capped at 64vh whatever this says, because a slide is fit and uniformly scaled (ADR-0013 §5.1) — an oversized frame is not clipped, it shrinks the whole slide, text included.',
    },
  ],
  examples: [
    {
      title: 'The course plan',
      code: `<SheetEmbed
  src="https://docs.google.com/spreadsheets/d/1_cxMUbcF9Tscd3_4Nu71HiXy-MZuaz28IapmvhS7FkM/edit?usp=sharing"
  title="Planificación del semestre"
/>`,
      render: () => <SheetEmbed src={PLAN} title="Planificación del semestre" />,
    },
    {
      title: 'Shorter, for a sheet with few rows',
      code: `<SheetEmbed
  src="https://docs.google.com/spreadsheets/d/1_cxMUbcF9Tscd3_4Nu71HiXy-MZuaz28IapmvhS7FkM/edit?usp=sharing"
  title="Fechas de laboratorio"
  height={260}
/>`,
      render: () => <SheetEmbed src={PLAN} title="Fechas de laboratorio" height={260} />,
    },
    {
      title: 'Given no title',
      code: `<SheetEmbed src="https://docs.google.com/spreadsheets/d/1_cxMUb.../edit?usp=sharing" />`,
      render: () => <SheetEmbed src={PLAN} />,
    },
    {
      title: 'Given something that is not a sheet',
      code: `<SheetEmbed src="https://example.com/plan.xlsx" title="Planificación" />`,
      render: () => <SheetEmbed src="https://example.com/plan.xlsx" title="Planificación" />,
    },
  ],
};
