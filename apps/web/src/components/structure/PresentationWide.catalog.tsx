import type { CatalogEntry } from '../../lib/catalogEntry';

import { PresentationWide } from './PresentationWide';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const presentationWideCatalogEntry: CatalogEntry = {
  name: 'PresentationWide',
  family: 'structure',
  description:
    "Breaks a block out of the presentation `<Slide>`'s prose max-width and re-anchors it to a fraction of the viewport width, centred. Book mode leaves it alone. Thin MDX wrapper around `useViewportBreakout` (the same primitive `<SortStepper>` and `<StepShow>` use internally).",
  whenToUse:
    "When a wide visual (a table, a `<SideBySide>` with two large widgets, a diagram) does not fit the slide's prose column in presentation. NOT needed for widgets that already break out on their own — `<SortStepper>` and every widget built on top of `<StepShow>` handle it themselves.",
  props: [
    {
      name: 'fraction',
      type: 'number',
      description:
        'Fraction of the viewport width. `1` = full viewport, `0.75` = 75% centred. Default `1`. Comparisons of two visuals side-by-side usually read better at `0.75`; a wide markdown table wants `0.8` — at the default `1` its columns run flush to both slide edges (#277, measured at 1440x900: 640px and slide scale 0.71 unwrapped, 1058px and scale 1.0 wrapped).',
    },
  ],
  examples: [
    {
      title: 'Two-tree side-by-side at 75 % of the viewport',
      code: '<PresentationWide fraction={0.75}>\n  <SideBySide left="A" right="B">\n    <div>… first tree …</div>\n    <div>… second tree …</div>\n  </SideBySide>\n</PresentationWide>',
      render: () => (
        <PresentationWide fraction={0.75}>
          <div className="rounded border border-rule bg-surface p-6 text-center text-sm text-ink-soft">
            (In book this block renders at the reading-column width. In presentation it re-anchors
            to 75&nbsp;% of the viewport.)
          </div>
        </PresentationWide>
      ),
    },
    {
      title: 'Wide table at 80 % of the viewport',
      code: '<PresentationWide fraction={0.8}>\n  <table>… wide comparison table …</table>\n</PresentationWide>',
      render: () => (
        <PresentationWide fraction={0.8}>
          <div className="rounded border border-rule bg-surface p-6 text-center text-sm text-ink-soft">
            (In presentation this table re-anchors to 80&nbsp;% of the viewport. At the default
            fraction 1 its columns would run flush to both slide edges.)
          </div>
        </PresentationWide>
      ),
    },
  ],
};
