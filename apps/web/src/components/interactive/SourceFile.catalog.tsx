import type { CatalogEntry } from '../../lib/catalogEntry';

// The lazy wrapper, aliased as a document writes it — the example renders what
// a document renders, and the catalog chunk stays off CodeMirror.
import { LazySourceFile as SourceFile } from './lazySourceFile';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const sourceFileCatalogEntry: CatalogEntry = {
  name: 'SourceFile',
  family: 'interactive',
  description:
    'A listing quoted from a source file kept beside the document (ADR-0091): a header with the file name, the range quoted and an open button; the gutter numbered as the file is; a fold row for the lines left out above and below; and a viewer with the whole file, the quoted lines banded.',
  whenToUse:
    'Instead of a fenced block when the code already lives in a file of the course — an interface, a class, a method quoted on several slides. One copy of the file, quoted wherever it is needed: change the file and every slide that quotes it changes. A fence stays right for code that exists only on its slide. Inside a step walk, <StepShow> quotes files the same way with codeSrc / programSrc / helperSrc.',
  props: [
    {
      name: 'src',
      type: 'string',
      description:
        'The file quoted, a path relative to the document (./26-grafos-tda-modelado.code/Graph.java). Resolved like a figure src. Only .java files are quotable (lib/contentCode.ts globs content/**/*.java; another language needs that glob widened); a missing file fails the content suite, and one outside the glob shows an authoring error.',
    },
    {
      name: 'range',
      type: 'string',
      description:
        'The lines quoted, "12-16" (or "12"). The whole file without it. A range past the end is clamped to the file.',
    },
    {
      name: 'name',
      type: 'string',
      description: 'The name in the header. The file name without it.',
    },
    {
      name: 'language',
      type: 'string',
      default: 'java',
      description: 'The grammar the listing is coloured as.',
    },
  ],
  examples: [
    {
      title: 'A range of a class, folds above and below',
      code: `<SourceFile src="./26-grafos-tda-modelado.code/AdjMatrixGraph.java" range="15-19" />`,
      render: () => (
        <SourceFile
          src="asset:courses/sample-course/26-grafos-tda-modelado.code/AdjMatrixGraph.java"
          range="15-19"
        />
      ),
    },
    {
      title: 'A whole file',
      code: `<SourceFile src="./26-grafos-tda-modelado.code/Graph.java" />`,
      render: () => (
        <SourceFile src="asset:courses/sample-course/26-grafos-tda-modelado.code/Graph.java" />
      ),
    },
  ],
};
