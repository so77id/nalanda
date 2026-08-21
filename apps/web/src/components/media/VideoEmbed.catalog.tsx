import type { CatalogEntry } from '../../lib/catalogEntry';

import { VideoEmbed } from './VideoEmbed';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const videoEmbedCatalogEntry: CatalogEntry = {
  name: 'VideoEmbed',
  family: 'media',
  description:
    'A playable YouTube frame, rendered inline as part of the page. Same shape as `<SheetEmbed>` for Google Sheets — the platform (YouTube) does the playback, this component frames it and says how tall.',
  whenToUse:
    'For external videos recommended alongside a class. The convention (see repo memory `feedback_videos_in_deck`) is that videos live in the deck, not only in long-form: the professor references the video in class without pressing play, and readers who want to go deeper have it right there. ' +
    'NOT for host-controlled uploads (there is no upload path in this platform — everything lives on YouTube). ' +
    'NOT for embedding video services that are not YouTube: the URL parser and sandbox tokens are YouTube-specific.',
  props: [
    {
      name: 'src',
      type: 'string',
      description:
        'The video URL, exactly as pasted from the browser. Accepts youtube.com/watch?v=…, youtu.be/…, /shorts/…, or /embed/… — the component derives the video id and rewrites into the embeddable form. Required.',
    },
    {
      name: 'title',
      type: 'string',
      description:
        'Accessible name of the frame, in Spanish. Required: a screen reader announces only this for an iframe.',
    },
    {
      name: 'height',
      type: 'number',
      description:
        'Frame height in px. Defaults to 480. Capped against the stage on a slide (SLIDE_BUDGET_VH) so it never overflows a presentation.',
    },
  ],
  examples: [
    {
      title: 'The Turing-machine analogy video (8 borrachos, Spanish)',
      code: '<VideoEmbed src="https://www.youtube.com/watch?v=S1PVPluvV9I" title="8 borrachos revolucionan las matemáticas" />',
      render: () => (
        <VideoEmbed
          src="https://www.youtube.com/watch?v=S1PVPluvV9I"
          title="8 borrachos revolucionan las matemáticas"
        />
      ),
    },
    {
      title: 'A youtu.be short link works the same as a full one',
      code: '<VideoEmbed src="https://youtu.be/S1PVPluvV9I" title="Maquina de Turing con analogias" />',
      render: () => (
        <VideoEmbed src="https://youtu.be/S1PVPluvV9I" title="Maquina de Turing con analogias" />
      ),
    },
    {
      title: 'Missing src: the error is for the author, not the student',
      code: '<VideoEmbed title="Video" />',
      render: () => <VideoEmbed title="Video" />,
    },
    {
      title: 'Non-YouTube URL is rejected with a clear message',
      code: '<VideoEmbed src="https://vimeo.com/12345" title="algo" />',
      render: () => <VideoEmbed src="https://vimeo.com/12345" title="algo" />,
    },
  ],
};
