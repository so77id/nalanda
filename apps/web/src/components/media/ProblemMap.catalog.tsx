import type { CatalogEntry } from '../../lib/catalogEntry';

import { ProblemMap } from './ProblemMap';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const problemMapCatalogEntry: CatalogEntry = {
  name: 'ProblemMap',
  family: 'media',
  description:
    "A unit's map of problems, as a table: every question the unit poses, its state seen from the document showing the map — solved here (mark), solved by an earlier document (keep), pending for a later one, or open in the course — and the tool that solves it. A pending problem's tool stays hidden; an open one's is named, since the course will not solve it.",
  whenToUse:
    'When a unit threads one list of problems through its documents, each opening on a row still open and closing on the map brought up to date (the Grafos unit, #356). The data lives ONCE, in content/courses/<course>/<map>.problems.yaml — `docs` in the unit’s order, and each problem’s `question`, `solvedIn` (absent: open) and `tool` — so the documents cannot drift apart, and none names another by number: the state is computed from `at`. ' +
    'Two runtime contracts: a map with no file and a document the map does not list each render an authoring error. Registered eagerly, like <NodeGraph>; its cost is measured where app/mdxComponents.ts registers it.',
  props: [
    {
      name: 'map',
      type: 'string',
      description: 'Which map: `grafos` reads `grafos.problems.yaml`.',
    },
    {
      name: 'at',
      type: 'string',
      description:
        'The id of the document showing it, one of the map’s `docs`: every state is relative to it.',
    },
  ],
  examples: [
    {
      title: 'Seen from the unit’s first document',
      code: `<ProblemMap map="grafos" at="grafos-representacion" />`,
      render: () => <ProblemMap map="grafos" at="grafos-representacion" />,
    },
    {
      title: 'Seen from the second: what the first solved is solved',
      code: `<ProblemMap map="grafos" at="grafos-recorridos" />`,
      render: () => <ProblemMap map="grafos" at="grafos-recorridos" />,
    },
  ],
};
