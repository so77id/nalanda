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
        'Fraction of the viewport width. `1` = full viewport, `0.75` = 75% centred. Default `1`. Comparisons of two visuals side-by-side usually read better at `0.75`.',
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
      title: 'Full-viewport wide table',
      code: '<PresentationWide>\n  <table>… wide comparison table …</table>\n</PresentationWide>',
      render: () => (
        <PresentationWide>
          <div className="rounded border border-rule bg-surface p-6 text-center text-sm text-ink-soft">
            (Default fraction 1 = the block re-anchors to the full viewport width in presentation.)
          </div>
        </PresentationWide>
      ),
    },
  ],
};
